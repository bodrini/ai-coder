import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AgentState } from "../state";

export async function validatorNode(state: typeof AgentState.State) {
  // 👈 Теперь берем конфиг прямо из стейта, не читая диск лишний раз
  const { workDir, plan, config, retryCount } = state;

  // --- 1. ОПТИМИЗАЦИЯ: Проверка типа действия ---
  const lastStepRaw = plan && plan.length > 0 ? plan[0] : null;
  if (lastStepRaw) {
    const lastStep = JSON.parse(lastStepRaw);
    const nonCodeActions = ['read', 'test', 'terminal', 'delete'];
    
    if (nonCodeActions.includes(lastStep.action)) {
      console.log(`ℹ️ [Validator] Действие ${lastStep.action} не меняет код. Пропускаю.`);
      return { isValidated: true };
    }
  }

  // Если команда линтера не задана — считаем, что всё ок
  if (!config.linterCommand || config.linterCommand.trim() === "") {
    console.log("ℹ️ [Validator] Команда валидации не задана. Пропускаю.");
    return { isValidated: true };
  }

  // --- 2. УМНАЯ ПРОВЕРКА ДЛЯ TYPESCRIPT ---
  // Если команда требует TS, но конфига нет — не спамим ошибками
  if (config.linterCommand.includes("tsc")) {
    const tsConfigPath = path.join(workDir, 'tsconfig.json');
    if (!fs.existsSync(tsConfigPath)) {
      console.log("⚠️ [Validator] Пропуск: tsc требует tsconfig.json, который отсутствует.");
      return { isValidated: true };
    }
  }

  console.log(`🛡️ [Validator] Запуск: ${config.linterCommand}`);

  try {
    execSync(config.linterCommand, { 
      cwd: workDir, 
      stdio: 'pipe',
      shell: true 
    } as any); 
    
    console.log("✅ [Validator] Код валиден.");
    return { 
      isValidated: true, 
      lintErrors: null,
      error: null // Сбрасываем системные ошибки, если линт прошел
    };

  } catch (error: any) {
    let errorMessage = error.stdout?.toString() || error.stderr?.toString() || error.message;

    // --- 3. ФИЛЬТРАЦИЯ: Оставляем только важное ---
    if (lastStepRaw) {
        const lastStep = JSON.parse(lastStepRaw);
        const fileName = path.basename(lastStep.file);
        
        const fileLines = errorMessage.split('\n')
            .filter((line: string) => line.toLowerCase().includes(fileName.toLowerCase()));
        
        if (fileLines.length > 0) {
            errorMessage = `Ошибка в файле ${lastStep.file}:\n${fileLines.join('\n')}`;
        }
    }
    
    console.warn("⚠️ [Validator] Обнаружены ошибки.");

    // Логируем для отладки в папку агента
    const logDir = path.join(process.cwd(), '.agent', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'last_lint_error.txt'), errorMessage);

    return { 
      isValidated: false, 
      lintErrors: errorMessage,
      retryCount: (retryCount || 0) + 1 
    };
  }
}