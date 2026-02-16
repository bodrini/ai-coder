import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../state"; 
import path from "path";
import { z } from "zod";
import fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

// 1. СХЕМА
const StepSchema = z.object({
  file: z.string().describe("Имя файла"),
  // Добавляем 'read' в возможные действия
  action: z.enum(["edit", "create", "delete", "test", "read"]).describe("Действие"),
  tool: z.enum(["gemini", "terminal"]).describe("Инструмент"), 
  description: z.string().describe("Описание задачи")
});

const PlanSchema = z.object({
  steps: z.array(StepSchema).describe("Список шагов")
});

// 2. МОДЕЛЬ
// Оставляем твою версию модели
const rawModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// Обучаем модель структуре
const structuredModel = rawModel.withStructuredOutput(PlanSchema);

// 3. ПЛАНИРОВЩИК
export async function plannerNode(state: typeof AgentState.State) {
  console.log("--- ПЛАНИРОВАНИЕ (Google Gemini) ---");

  const targetPath = state.workDir; 

  // Собираем список файлов для контекста
  let filesInProject: string[] = [];
  
  try {
    // 1. Читаем views
    const viewsPath = path.join(targetPath, "views");
    if (fs.existsSync(viewsPath)) {
        const views = fs.readdirSync(viewsPath).map(f => `views/${f}`);
        filesInProject.push(...views);
    }
    
    // 2. Читаем router
    const routerPath = path.join(targetPath, "router");
    if (fs.existsSync(routerPath)) {
        const routes = fs.readdirSync(routerPath).map(f => `router/${f}`);
        filesInProject.push(...routes);
    }
    
    // 3. Читаем корень src (App.vue, main.ts)
    if (fs.existsSync(targetPath)) {
        const rootFiles = fs.readdirSync(targetPath)
            .filter(f => f.endsWith(".vue") || f.endsWith(".ts"))
            .map(f => f); 
        filesInProject.push(...rootFiles);
    }

  } catch (e) {
    console.log("Ошибка сканирования папок:", e);
  }

  // --- ЛОГИКА ОБРАБОТКИ ОШИБОК ---
  const { error, task } = state;
  let currentTask = task;
  
  // Если Executor вернул ошибку, меняем задачу на "Исправление"
  if (error) {
    console.log("🚑 РЕЖИМ ИСПРАВЛЕНИЯ ОШИБОК");
    console.log(`Текст ошибки: ${error}`);

    currentTask = `
      СИТУАЦИЯ КРИТИЧЕСКАЯ. ПРЕДЫДУЩИЙ ПЛАН ПРОВАЛИЛСЯ С ОШИБКОЙ:
      "${error}"
      
      ИСХОДНАЯ ЗАДАЧА БЫЛА: "${task}"

      ТВОЯ ЦЕЛЬ: 
      1. Проанализируй ошибку.
      2. Составь НОВЫЙ план, чтобы исправить её. 
      3. Если ошибка в коде - используй 'edit'.
      4. Если ошибка в отсутствии файла - используй 'create'.
      5. Если нужно проверить содержимое файла перед правкой - используй 'read'.
      
      НЕ ПОВТОРЯЙ действия, которые привели к ошибке.
    `;
  }
  
  const prompt = `
    Ты - Senior Vue 3 Developer.
    Рабочая директория (root): ${targetPath}
    Доступные файлы: ${filesInProject.join(", ")}.
    
    ТЕКУЩАЯ ЗАДАЧА: ${currentTask}
    
    Составь план действий.
    
    ВАЖНО ПРО РОУТИНГ:
    Если задача требует добавить новую страницу в навигацию:
    1. Сначала создай компонент (во views/).
    2. Запланируй шаг: read 'router/index.ts'.
    3. Запланируй шаг: edit 'router/index.ts' (импортируй компонент и добавь объект в routes).
    
    ИНСТРУМЕНТЫ:
    - 'gemini' + 'read': для чтения контекста файла.
    - 'gemini' + 'edit'/'create': для написания кода.
    - 'terminal': для команд.
  `;

  const response = await structuredModel.invoke(prompt);
  
  return { 
    files: filesInProject,
    plan: response.steps.map(s => JSON.stringify(s)) 
  };
}