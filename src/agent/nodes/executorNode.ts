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

  // Получаем рабочую папку из стейта
  const workingDirectory = state.workDir;

  // Проверка на случай, если путь не передан
  if (!workingDirectory) {
    console.error("❌ Ошибка: Не указана рабочая директория (workDir)!");
    return { plan: [], currentCode: "Error: No workDir" };
  }

  console.log(`🚀 Задача: ${task.action} -> ${task.file} [${task.tool}]`);
  console.log(`📂 В папке: ${workingDirectory}`);

  let resultOutput = "";

  try {
    // --- ВЕТКА A: ТЕРМИНАЛ ---
    if (task.tool === "terminal") {
      // ВАЖНО: Добавлена опция { cwd: workingDirectory }
      // Теперь команды выполняются внутри папки проекта, а не внутри агента
      
      if (task.action === "test") {
        console.log("🖥️ Запускаю тесты...");
        const { stdout, stderr } = await execAsync("npm test", { cwd: workingDirectory });
        resultOutput = stdout || stderr;
      } else if (task.action === "build") {
        console.log("📦 Запускаю сборку...");
        const { stdout } = await execAsync("npm run build", { cwd: workingDirectory });
        resultOutput = stdout;
      } else {
        // Выполнение произвольной команды из description
        const { stdout, stderr } = await execAsync(task.description, { cwd: workingDirectory });
        resultOutput = stdout || stderr;
      }

    // --- ВЕТКА B: GEMINI (КОДЕР) ---
    } else if (task.tool === "gemini") {
      
      const fullFilePath = path.join(workingDirectory, task.file);

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
        
        ТЕКУЩИЙ КОД:
        \`\`\`vue
        ${fileContent}
        \`\`\`

        ТРЕБОВАНИЯ:
        1. Верни ПОЛНЫЙ валидный код файла.
        2. НЕ пиши никаких объяснений. Только код внутри блока кода.
        3. Используй <script setup lang="ts">.
      `;

      const response = await geminiCoder.invoke(prompt);
      const rawText = response.content as string;

      // Очистка
      resultOutput = rawText
        .replace(/```vue/g, "")
        .replace(/```html/g, "")
        .replace(/```typescript/g, "")
        .replace(/```ts/g, "")
        .replace(/```/g, "")
        .trim();

      if (task.action === "edit" || task.action === "create") {
          // Гарантируем, что папка существует перед записью
          const dir = path.dirname(fullFilePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(fullFilePath, resultOutput);
          console.log(`✅ Файл сохранен: ${fullFilePath}`);
      }
    }

  } catch (error) {
    console.error(`❌ Ошибка выполнения: ${error}`);
    resultOutput = `Error: ${error}`;
  }

  return {
    plan: currentPlan.slice(1),
    currentCode: resultOutput
  };
}