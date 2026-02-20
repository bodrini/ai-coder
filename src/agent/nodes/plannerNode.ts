import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../state"; 
import path from "path";
import { z } from "zod";
import fs from "fs";
import * as dotenv from "dotenv";
import { loadPrompt } from "../utils/promptLoader";
import { getContextViaRAG } from "../utils/rag";
import { loadAgentConfig } from "../utils/configLoader"; // 👈 ИЗМЕНЕНИЕ: импорт загрузчика конфига

dotenv.config();

// 1. СХЕМА ОТВЕТА
const StepSchema = z.object({
  file: z.string().describe("Имя файла, с которым работаем"),
  action: z.enum(["edit", "create", "delete", "test", "read"]).describe("Действие"),
  tool: z.enum(["gemini", "terminal"]).describe("Инструмент"), 
  description: z.string().describe("Команда для терминала или описание правки")
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
  console.log("--- ЭТАП: ПЛАНИРОВАНИЕ (Универсальный режим) ---");

  // 👈 Загружаем конфиг (локальный или глобальный) 
  const config = loadAgentConfig(state.workDir);
  const targetPath = state.workDir; 

  // --- ШАГ A: Универсальное сканирование файловой системы ---
  // 👈 ИЗМЕНЕНИЕ: Теперь сканируем папки динамически на основе конфига
  let filesInProject: string[] = [];
  
  try {
    config.contextFiles.forEach(contextDir => {
      const fullPath = path.join(targetPath, contextDir);
      
      if (fs.existsSync(fullPath)) {
        // Рекурсивный поиск файлов в указанных директориях
        const getFiles = (dir: string): string[] => {
          let results: string[] = [];
          const list = fs.readdirSync(dir);
          list.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat && stat.isDirectory()) {
              results = results.concat(getFiles(filePath));
            } else {
              // Добавляем только кодовые файлы
              if (/\.(ts|js|vue|json|py|go)$/.test(file)) {
                // Превращаем абсолютный путь в относительный для агента
                results.push(path.relative(targetPath, filePath));
              }
            }
          });
          return results;
        };
        filesInProject.push(...getFiles(fullPath));
      }
    });
  } catch (e) {
    console.log("⚠️ Ошибка сканирования папок:", e);
  }

  // --- ШАГ B: Обработка ошибок (Self-Healing) ---
  const { error, lintErrors, task, memory } = state;
  let currentTask = task;
  
  if (error || lintErrors) {
    console.log("🚑 ВКЛЮЧЕН РЕЖИМ ИСПРАВЛЕНИЯ");
    currentTask = `
      ПРЕДЫДУЩАЯ ПОПЫТКА ЗАВЕРШИЛАСЬ ОШИБКОЙ.
      ${error ? `🆘 ОШИБКА: "${error}"` : ""}
      ${lintErrors ? `🚨 ЛОГ ВАЛИДАЦИИ:\n${lintErrors}` : ""}
      ИСХОДНАЯ ЦЕЛЬ: "${task}"
      ТВОЯ НОВАЯ ЦЕЛЬ: Исправь ошибки, следуя правилам проекта.
    `;
  }

  // 🔥 ШАГ B.2: RAG 🔥
  let ragContext = "RAG context empty.";
  try {
    if (!error) {
       ragContext = await getContextViaRAG(targetPath, task); 
    }
  } catch (e) {
    console.error("⚠️ RAG Error:", e);
  }
  
  // --- ШАГ C: Загрузка промпта с переменными из Конфига ---
  // 👈 ИЗМЕНЕНИЕ: Передаем ВСЕ данные из agent.config.json
  const prompt = loadPrompt("planner.md", {
    role: config.role,
    projectType: config.projectType,
    techStack: config.techStack.join(", "),
    rules: config.rules.map(r => `- ${r}`).join("\n"),
    linterCommand: config.linterCommand,
    workDir: targetPath,
    files: filesInProject.join(", ") || "No files found",
    task: currentTask,
    memory: memory || "История пуста.",
    rag: ragContext
  });

  try {
    const response = await structuredModel.invoke(prompt);
    
    return { 
      files: filesInProject,
      plan: response.steps.map(s => JSON.stringify(s)),
    };
    
  } catch (e) {
    console.error("💥 Ошибка генерации плана:", e);
    return { plan: [] };
  }
}