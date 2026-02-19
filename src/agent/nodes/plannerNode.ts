import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../state"; 
import path from "path";
import { z } from "zod";
import fs from "fs";
import * as dotenv from "dotenv";
import { loadPrompt } from "../utils/promptLoader"; // Импортируем наш загрузчик
import { getContextViaRAG } from "../utils/rag"; // 👈 Импортируем наш семантический поиск

dotenv.config();

// 1. СХЕМА ОТВЕТА (JSON Output)
const StepSchema = z.object({
  file: z.string().describe("Имя файла, с которым работаем (например, views/Home.vue)"),
  action: z.enum(["edit", "create", "delete", "test", "read"]).describe("Действие"),
  tool: z.enum(["gemini", "terminal"]).describe("Инструмент"), 
  description: z.string().describe("Краткое описание, что именно нужно сделать в этом шаге")
});

const PlanSchema = z.object({
  steps: z.array(StepSchema).describe("Массив шагов для выполнения задачи")
});

// 2. МОДЕЛЬ
// Используем ту же модель, что и в Исполнителе
const rawModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0, // Для планирования нужна строгость
});

// Оборачиваем модель для структурированного вывода (JSON)
const structuredModel = rawModel.withStructuredOutput(PlanSchema);

// 3. ФУНКЦИЯ ПЛАНИРОВЩИКА
export async function plannerNode(state: typeof AgentState.State) {
  console.log("--- ЭТАП: ПЛАНИРОВАНИЕ (Gemini) ---");

  const targetPath = state.workDir; 

  // --- ШАГ A: Сканирование файловой системы ---
  // Агент должен знать, какие файлы уже существуют
  let filesInProject: string[] = [];
  
  try {
    // Теперь мы ищем внутри папки SRC
    const srcPath = path.join(targetPath, "src");

    if (fs.existsSync(srcPath)) {
        // 1. Читаем views
        const viewsPath = path.join(srcPath, "views");
        if (fs.existsSync(viewsPath)) {
            const views = fs.readdirSync(viewsPath).map(f => `src/views/${f}`);
            filesInProject.push(...views);
        }
        
        // 2. Читаем router
        const routerPath = path.join(srcPath, "router");
        if (fs.existsSync(routerPath)) {
            const routes = fs.readdirSync(routerPath).map(f => `src/router/${f}`);
            filesInProject.push(...routes);
        }
        
        // 3. Читаем корень src (App.vue, main.ts)
        const rootFiles = fs.readdirSync(srcPath)
            .filter(f => f.endsWith(".vue") || f.endsWith(".ts"))
            .map(f => `src/${f}`); // Добавляем префикс src/
        filesInProject.push(...rootFiles);
    }
  } catch (e) {
    console.log("⚠️ Ошибка сканирования папок:", e);
  }

  // --- ШАГ B: Обработка ошибок (Self-Healing) ---
  const { error, task, memory } = state;
  let currentTask = task; // По умолчанию делаем то, что просил юзер
  
  if (error) {
    console.log("🚑 ВКЛЮЧЕН РЕЖИМ ИСПРАВЛЕНИЯ ОШИБОК");
    console.log(`Текст ошибки: ${error}`);

    // Если есть ошибка, мы подменяем задачу для LLM
    currentTask = `
      СИТУАЦИЯ КРИТИЧЕСКАЯ. ПРЕДЫДУЩИЙ ПЛАН ПРОВАЛИЛСЯ.
      
      ОШИБКА: "${error}"
      
      ИСХОДНАЯ ЦЕЛЬ БЫЛА: "${task}"

      ТВОЯ НОВАЯ ЦЕЛЬ: 
      1. Проанализируй ошибку.
      2. Составь план исправления.
      3. Если файл не найден -> создай его.
      4. Если ошибка в коде -> используй 'edit'.
      5. Если не уверен, что внутри файла -> сначала 'read'.
      
      НЕ ПОВТОРЯЙ действия, которые уже привели к ошибке!
    `;
  }

  // 🔥 ШАГ B.2: RAG (Семантический поиск по кодовой базе) 🔥
  let ragContext = "RAG отключен или произошла ошибка.";
  try {
    // Делаем поиск только если это нормальная задача (а не исправление ошибки)
    // чтобы не тратить токены на поиск кода по тексту логов ошибки
    if (!error) {
       // Передаем исходную задачу (task), а не currentTask, так как она лучше подходит для поиска
       ragContext = await getContextViaRAG(targetPath, task); 
    } else {
       ragContext = "Внимание: Это попытка исправить ошибку. Ориентируйся на лог ошибки ниже.";
    }
  } catch (e) {
    console.error("⚠️ Ошибка семантического поиска (RAG):", e);
  }
  
  // --- ШАГ C: Загрузка промпта и Вызов Gemini ---
  
  // Загружаем текст из prompts/planner.md и подставляем переменные
  const prompt = loadPrompt("planner.md", {
    workDir: targetPath,
    files: filesInProject.join(", ") || "Нет файлов",
    task: currentTask,
    memory: memory || "История пуста.", 
    rag: ragContext // 👈 Передаем найденные куски кода в системный промпт
  });

  try {
    const response = await structuredModel.invoke(prompt);
    
    // Возвращаем обновленный стейт
    return { 
      files: filesInProject, // Обновляем список файлов в памяти
      plan: response.steps.map(s => JSON.stringify(s)), // Конвертируем план в массив строк
      // Ошибку не сбрасываем здесь! Её сбросит Исполнитель после успешного шага.
    };
    
  } catch (e) {
    console.error("💥 Ошибка при генерации плана:", e);
    // Возвращаем пустой план, граф сам решит, что делать (завершит работу)
    return { plan: [] };
  }
}