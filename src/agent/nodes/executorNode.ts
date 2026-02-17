import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import fs from "fs";
import { AgentState } from "../state";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import { loadPrompt } from "../utils/promptLoader"; // 1. Импортируем загрузчик

dotenv.config();

const execAsync = promisify(exec);

// НАСТРОЙКА GEMINI
const geminiCoder = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.1,
});

export async function executorNode(state: typeof AgentState.State) {
  console.log("--- ЭТАП: ВЫПОЛНЕНИЕ (Gemini) ---");

  const currentPlan = state.plan;

  if (!currentPlan || currentPlan.length === 0) {
    return { plan: [] };
  }

  const taskJson = currentPlan[0];
  const task = JSON.parse(taskJson);

  const workingDirectory = state.workDir;
  const currentContext = state.context || ""; 
  const currentRetries = state.retryCount || 0;
  
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
        const command = task.action === "test" ? "npm test" 
                      : task.action === "build" ? "npm run build" 
                      : task.description;

        console.log(`🖥️ Exec: ${command}`);
        const { stdout } = await execAsync(command, { cwd: workingDirectory });
        resultOutput = stdout;

      } catch (cmdError: any) {
        console.error("💥 ОШИБКА В ТЕРМИНАЛЕ! (+1 к попыткам)");
        return {
          plan: [], 
          error: `Ошибка выполнения команды '${task.description}': ${cmdError.message || cmdError.stderr}`,
          context: newContextData,
          retryCount: currentRetries + 1
        };
      }

    // --- ВЕТКА B: GEMINI ---
    } else if (task.tool === "gemini") {
      
      const fullFilePath = path.join(workingDirectory, task.file);

      // 1. READ (Чтение)
      if (task.action === "read") {
        console.log(`👀 Читаю файл: ${task.file}`);
        try {
          if (fs.existsSync(fullFilePath)) {
            const content = fs.readFileSync(fullFilePath, 'utf-8');
            resultOutput = `Файл прочитан.`;
            newContextData = `\n=== КОНТЕКСТ ФАЙЛА ${task.file} ===\n${content}\n`;
          } else {
            resultOutput = `Файл ${task.file} не найден.`;
            console.log("⚠️ Файл не найден.");
          }
        } catch (e) {
          resultOutput = `Ошибка чтения: ${e}`;
        }
      }

      // 2. EDIT / CREATE (Изменение кода)
      else if (task.action === "edit" || task.action === "create") {
        
        let fileContent = "";
        try {
          if (fs.existsSync(fullFilePath)) {
             fileContent = fs.readFileSync(fullFilePath, 'utf-8');
          }
        } catch (e) { console.log("Файл новый."); }

        // 2. ЗАГРУЖАЕМ ПРОМПТ ИЗ ФАЙЛА executor.md
        const prompt = loadPrompt("executor.md", {
            description: task.description,
            file: task.file,
            context: currentContext,
            fileContent: fileContent
        });

        const response = await geminiCoder.invoke(prompt);
        const rawText = response.content as string;

        // Очистка от маркдауна (```vue и т.д.)
        resultOutput = rawText
          .replace(/```vue/g, "")
          .replace(/```html/g, "")
          .replace(/```typescript/g, "")
          .replace(/```ts/g, "")
          .replace(/```/g, "")
          .trim();

        // Создаем папку, если её нет
        const dir = path.dirname(fullFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Записываем файл
        fs.writeFileSync(fullFilePath, resultOutput);
        console.log(`✅ Файл сохранен: ${fullFilePath}`);
      }
    }

  } catch (error: any) {
    console.error(`❌ Критическая ошибка Исполнителя: ${error}`);
    return {
      plan: [],
      error: `System Error: ${error.message || String(error)}`,
      retryCount: currentRetries + 1
    };
  }

  // ✅ УСПЕХ
  return {
    plan: currentPlan.slice(1),
    currentCode: resultOutput,
    context: newContextData,
    error: "", 
    retryCount: 0 
  };
}