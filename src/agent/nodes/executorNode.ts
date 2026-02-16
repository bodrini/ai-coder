import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import fs from "fs";
import { AgentState } from "../state";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from "dotenv";

dotenv.config();

const execAsync = promisify(exec);

// 1. НАСТРОЙКА GEMINI
// Используем указанную тобой модель. 
// (Если упадет с 404, поменяй на 'gemini-1.5-flash')
const geminiCoder = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0.1,
});

export async function executorNode(state: typeof AgentState.State) {
  console.log("--- ЭТАП: ВЫПОЛНЕНИЕ (Gemini) ---");

  const currentPlan = state.plan;

  // Если плана нет - выходим
  if (!currentPlan || currentPlan.length === 0) {
    return { plan: [] };
  }

  const taskJson = currentPlan[0];
  const task = JSON.parse(taskJson);

  // Получаем рабочую папку, контекст и счетчик попыток
  const workingDirectory = state.workDir;
  const currentContext = state.context || ""; 
  const currentRetries = state.retryCount || 0; // <--- Важно для счетчика
  
  let newContextData = "";
  let resultOutput = ""; // Объявляем один раз

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
        // 🛑 ОШИБКА КОМАНДЫ
        console.error("💥 ОШИБКА В ТЕРМИНАЛЕ! (+1 к попыткам)");
        return {
          plan: [], 
          error: `Ошибка выполнения команды '${task.description}': ${cmdError.message || cmdError.stderr}`,
          context: newContextData,
          // 🔥 ИНКРЕМЕНТ: Увеличиваем счетчик ошибок
          retryCount: currentRetries + 1
        };
      }

    // --- ВЕТКА B: GEMINI ---
    } else if (task.tool === "gemini") {
      
      const fullFilePath = path.join(workingDirectory, task.file);

      // 1. READ
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

      // 2. EDIT / CREATE
      else if (task.action === "edit" || task.action === "create") {
        
        let fileContent = "";
        try {
          if (fs.existsSync(fullFilePath)) {
             fileContent = fs.readFileSync(fullFilePath, 'utf-8');
          }
        } catch (e) { console.log("Файл новый."); }

        const prompt = `
          Ты - Vue 3 Эксперт.
          ЗАДАЧА: ${task.description}
          ФАЙЛ: ${task.file}
          
          🧠 КОНТЕКСТ ПРОЕКТА:
          ${currentContext}
          
          ТЕКУЩИЙ КОД:
          \`\`\`vue
          ${fileContent}
          \`\`\`

          ТРЕБОВАНИЯ:
          1. Верни ПОЛНЫЙ валидный код файла.
          2. Только код.
          3. <script setup lang="ts">.
        `;

        const response = await geminiCoder.invoke(prompt);
        const rawText = response.content as string;

        resultOutput = rawText
          .replace(/```vue/g, "")
          .replace(/```html/g, "")
          .replace(/```typescript/g, "")
          .replace(/```ts/g, "")
          .replace(/```/g, "")
          .trim();

        const dir = path.dirname(fullFilePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(fullFilePath, resultOutput);
        console.log(`✅ Файл сохранен: ${fullFilePath}`);
      }
    }

  } catch (error: any) {
    // 🛑 ГЛОБАЛЬНАЯ ОШИБКА (API и т.д.)
    console.error(`❌ Критическая ошибка Исполнителя: ${error}`);
    return {
      plan: [],
      error: `System Error: ${error.message || String(error)}`,
      // 🔥 ИНКРЕМЕНТ
      retryCount: currentRetries + 1
    };
  }

  // ✅ УСПЕХ
  return {
    plan: currentPlan.slice(1),
    currentCode: resultOutput,
    context: newContextData,
    error: "", 
    // 🔥 СБРОС: Если шаг успешен, обнуляем счетчик
    retryCount: 0 
  };
}