import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export async function validatorNode(state: any) {
  const { workDir, plan } = state; // ДОБАВЛЕНО: достаем план

  // --- 1. ОПТИМИЗАЦИЯ: Проверка типа действия ---
  // ДОБАВЛЕНО: Если план пуст или последнее действие не меняло файлы — скипаем линт
  const lastStepRaw = plan && plan.length > 0 ? plan[0] : null;
  if (lastStepRaw) {
    const lastStep = JSON.parse(lastStepRaw);
    // Пропускаем линт для действий, которые не меняют код
    if (['read', 'test', 'terminal'].includes(lastStep.action)) {
      console.log(`ℹ️ [Linter] Действие ${lastStep.action} не меняет код. Пропускаю.`);
      return { ...state, isValidated: true };
    }
  }

  const tsConfigPath = path.join(workDir, 'tsconfig.json');

  if (!fs.existsSync(tsConfigPath)) {
    console.log("ℹ️ [Linter] tsconfig.json не найден, пропускаю проверку типов.");
    return { ...state, isValidated: true };
  }

  console.log("🛡️ [Linter] Запуск проверки типов (tsc)...");

  try {
    // ДОБАВЛЕНО: используем vue-tsc, если проект на Vue, иначе tsc
    const linterCmd = fs.existsSync(path.join(workDir, 'node_modules', '.bin', 'vue-tsc')) 
      ? 'npx vue-tsc --noEmit' 
      : 'npx tsc --noEmit';

    execSync(linterCmd, { cwd: workDir, stdio: 'pipe' });
    
    return { ...state, isValidated: true, lintErrors: null };
  } catch (error: any) {
    let errorMessage = error.stdout?.toString() || error.message;

    // --- 2. ОПТИМИЗАЦИЯ: Фильтрация шума ---
    // ДОБАВЛЕНО: Если мы знаем, какой файл правили, оставим только ошибки по нему
    if (lastStepRaw) {
        const lastStep = JSON.parse(lastStepRaw);
        const fileLines = errorMessage.split('\n')
            .filter((line: string) => line.includes(lastStep.file));
        
        if (fileLines.length > 0) {
            errorMessage = "Найдены ошибки в измененном файле:\n" + fileLines.join('\n');
        }
    }
    
    const logDir = path.join(workDir, '.agent', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'last_lint_error.txt'), errorMessage);

    return { 
      ...state, 
      isValidated: false, 
      lintErrors: errorMessage,
      // ВАЖНО: retryCount увеличивается в shouldContinue или здесь, 
      // убедись, что он не суммируется дважды
      retryCount: (state.retryCount || 0) + 1 
    };
  }
}