import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import fs from "fs";
import { AgentState } from "../state";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import { loadPrompt } from "../utils/promptLoader";

dotenv.config();

const execAsync = promisify(exec);

// Используем 1.5-flash для работы с кодом (более высокие лимиты запросов)
const geminiCoder = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.1,
});

export async function executorNode(state: typeof AgentState.State) {
  console.log("--- ЭТАП: ВЫПОЛНЕНИЕ (Gemini) ---");

  // 👈 Извлекаем config из стейта
  const { plan, workDir, context, retryCount, lintErrors, config } = state;

  if (!plan || plan.length === 0) {
    return { plan: [] };
  }

  const taskJson = plan[0];
  const task = JSON.parse(taskJson);
  const workingDirectory = workDir;
  
  let newContextData = "";
  let resultOutput = ""; 

  if (!workingDirectory) {
    return { plan: [], error: "Critical: No workDir provided" };
  }

  console.log(`🚀 Задача: ${task.action} -> ${task.file} [${task.tool}]`);
  
  try {
    // --- ВЕТКА A: ТЕРМИНАЛ ---
    if (task.tool === "terminal") {
      try {
        // Команды теперь более гибкие (можно расширить логику под разные менеджеры пакетов)
        const command = task.action === "test" ? "npm test" 
                      : task.action === "build" ? "npm run build" 
                      : task.description;

        console.log(`🖥️ Exec: ${command}`);
        const { stdout } = await execAsync(command, { cwd: workingDirectory });
        resultOutput = stdout;

      } catch (cmdError: any) {
        console.error("💥 ОШИБКА В ТЕРМИНАЛЕ!");
        return {
          error: `Ошибка команды: ${cmdError.message || cmdError.stderr}`,
          retryCount: (retryCount || 0) + 1
        };
      }

    // --- ВЕТКА B: GEMINI ---
    } else if (task.tool === "gemini") {
      const fullFilePath = path.join(workingDirectory, task.file);

      // 1. READ (Чтение)
      if (task.action === "read") {
        console.log(`👀 Читаю файл: ${task.file}`);
        if (fs.existsSync(fullFilePath)) {
          const content = fs.readFileSync(fullFilePath, 'utf-8');
          resultOutput = `Файл прочитан.`;
          newContextData = `\n=== КОНТЕКСТ ФАЙЛА ${task.file} ===\n${content}\n`;
        } else {
          resultOutput = `Файл ${task.file} не найден.`;
        }
      }

      // 2. EDIT / CREATE (Изменение кода)
      else if (task.action === "edit" || task.action === "create") {
        let fileContent = "";
        if (fs.existsSync(fullFilePath)) {
          fileContent = fs.readFileSync(fullFilePath, 'utf-8');
        }

        // 👈 ПЕРЕДАЕМ ДАННЫЕ ИЗ КОНФИГА В ПРОМПТ ИСПОЛНИТЕЛЯ
        const prompt = loadPrompt("executor.md", {
            projectType: config.projectType, // Теперь Executor знает, что он во Vue или Node
            techStack: config.techStack.join(", "),
            description: task.description,
            file: task.file,
            context: (context || "") + (lintErrors ? `\n⚠️ ОШИБКИ ВАЛИДАЦИИ:\n${lintErrors}` : ""),
            fileContent: fileContent
        });

        const response = await geminiCoder.invoke(prompt);
        const rawText = response.content as string;

        // Расширенная очистка от маркдауна (добавили типичные расширения)
        resultOutput = rawText
          .replace(/```(vue|html|typescript|ts|javascript|js|json|css|scss|python|py|go|rust|rs)/g, "")
          .replace(/```/g, "")
          .trim();

        const dir = path.dirname(fullFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(fullFilePath, resultOutput);
        console.log(`✅ Файл сохранен: ${task.file}`);
      }
    }

    // ✅ УСПЕШНОЕ ВЫПОЛНЕНИЕ ШАГА
    return {
      plan: plan.slice(1),
      currentCode: resultOutput,
      context: newContextData,
      error: null,
      lintErrors: null, // Сбрасываем ошибки, так как мы сделали шаг к их исправлению
      isValidated: false // Отправляем на проверку в ValidatorNode
    };

  } catch (error: any) {
    // --- ОБРАБОТКА ОШИБОК И ЛИМИТОВ ---
    if (error.message?.includes('429')) {
      console.log("⏳ [!] Превышен лимит запросов (429). Сплю 30 секунд...");
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    console.error(`❌ Критическая ошибка Исполнителя: ${error.message}`);
    return {
      error: `System Error: ${error.message || String(error)}`,
      retryCount: (retryCount || 0) + 1
    };
  }
}