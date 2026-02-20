import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../state"; 
import path from "path";
import { z } from "zod";
import fs from "fs";
import * as dotenv from "dotenv";
import { loadPrompt } from "../utils/promptLoader";
import { getContextViaRAG } from "../utils/rag";

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
const rawModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", 
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

const structuredModel = rawModel.withStructuredOutput(PlanSchema);

// 3. ФУНКЦИЯ ПЛАНИРОВЩИКА
export async function plannerNode(state: typeof AgentState.State) {
  console.log("--- ЭТАП: ПЛАНИРОВАНИЕ (Gemini) ---");

  const targetPath = state.workDir; 

  // --- ШАГ A: Сканирование файловой системы ---
  let filesInProject: string[] = [];
  
  try {
    const srcPath = path.join(targetPath, "src");

    if (fs.existsSync(srcPath)) {
        const viewsPath = path.join(srcPath, "views");
        if (fs.existsSync(viewsPath)) {
            const views = fs.readdirSync(viewsPath).map(f => `src/views/${f}`);
            filesInProject.push(...views);
        }
        
        const routerPath = path.join(srcPath, "router");
        if (fs.existsSync(routerPath)) {
            const routes = fs.readdirSync(routerPath).map(f => `src/router/${f}`);
            filesInProject.push(...routes);
        }
        
        const rootFiles = fs.readdirSync(srcPath)
            .filter(f => f.endsWith(".vue") || f.endsWith(".ts"))
            .map(f => `src/${f}`);
        filesInProject.push(...rootFiles);
    }
  } catch (e) {
    console.log("⚠️ Ошибка сканирования папок:", e);
  }

  // --- ШАГ B: Обработка ошибок (Self-Healing + Linting) ---
  const { error, lintErrors, task, memory } = state;
  let currentTask = task;
  
  if (error || lintErrors) {
    console.log("🚑 ВКЛЮЧЕН РЕЖИМ ИСПРАВЛЕНИЯ");
    
    // Формируем детальное описание проблемы для ИИ
    currentTask = `
      ПРЕДЫДУЩАЯ ПОПЫТКА ВЫПОЛНЕНИЯ ЗАВЕРШИЛАСЬ ОШИБКОЙ.
      
      ${error ? `🆘 КРИТИЧЕСКАЯ ОШИБКА: "${error}"` : ""}
      ${lintErrors ? `🚨 ОШИБКИ ВАЛИДАЦИИ (ЛИНТЕРА/ТИПОВ):\n${lintErrors}` : ""}
      
      ИСХОДНАЯ ЦЕЛЬ: "${task}"

      ТВОЯ НОВАЯ ЦЕЛЬ:
      1. Проанализируй логи ошибок.
      2. Если есть ошибки типов (TypeScript) — проверь интерфейсы и импорты.
      3. Если ошибка линтера — исправь синтаксис в режиме 'edit'.
      4. Если файл не найден — запланируй его создание.
      
      НЕ ПОВТОРЯЙ те же самые действия, которые привели к этим ошибкам!
    `;
  }

  // 🔥 ШАГ B.2: RAG (Семантический поиск) 🔥
  let ragContext = "RAG отключен или произошла ошибка.";
  try {
    // Если есть lintErrors, мы все равно можем сделать поиск по исходной задаче,
    // чтобы не потерять контекст того, ЧТО мы строили.
    if (!error) {
       ragContext = await getContextViaRAG(targetPath, task); 
    } else {
       ragContext = "Внимание: Режим исправления. Ориентируйся на предоставленные логи ошибок.";
    }
  } catch (e) {
    console.error("⚠️ Ошибка семантического поиска (RAG):", e);
  }
  
  // --- ШАГ C: Загрузка промпта и Вызов Gemini ---
  const prompt = loadPrompt("planner.md", {
    workDir: targetPath,
    files: filesInProject.join(", ") || "Нет файлов",
    task: currentTask,
    memory: memory || "История пуста.",
    rag: ragContext
  });

  try {
    const response = await structuredModel.invoke(prompt);
    
    return { 
      files: filesInProject,
      plan: response.steps.map(s => JSON.stringify(s)),
      // Мы не сбрасываем здесь lintErrors/error, чтобы Executor видел их, 
      // если ему нужно дополнительное условие. Сброс будет в Executor после успеха.
    };
    
  } catch (e) {
    console.error("💥 Ошибка при генерации плана:", e);
    return { plan: [] };
  }
}