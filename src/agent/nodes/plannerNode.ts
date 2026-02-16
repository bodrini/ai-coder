import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "../state"; 
import path from "path";
import { z } from "zod";
import fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

// 1. СХЕМА
const StepSchema = z.object({
  file: z.string().describe("Имя файла для работы (например: AboutView.vue)"),
  action: z.enum(["edit", "create", "delete", "test"]).describe("Тип действия"),
  // Теперь наш инструмент называется 'gemini'
  tool: z.enum(["gemini", "terminal"]).describe("Инструмент"), 
  description: z.string().describe("Описание задачи")
});

const PlanSchema = z.object({
  steps: z.array(StepSchema).describe("Список шагов")
});

// 2. МОДЕЛЬ (Gemini 1.5 Flash)
const rawModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash", // Быстрая и бесплатная
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});

// Обучаем модель структуре
const structuredModel = rawModel.withStructuredOutput(PlanSchema);

// 3. ПЛАНИРОВЩИК
export async function plannerNode(state: typeof AgentState.State) {
  console.log("--- ПЛАНИРОВАНИЕ (Google Gemini) ---");

  const targetPath = state.workDir; 

  console.log(`📂 Сканирую папку: ${targetPath}`);

  let filesInProject: string[] = [];
  try {
    // Читаем файлы из переданной папки
    filesInProject = fs.readdirSync(targetPath);
  } catch (e) {
    console.error(`❌ Ошибка: Папка ${targetPath} не найдена!`);
    return { files: [], plan: [] }; // Прерываем работу, если папки нет
  }
  
  const prompt = `
    Ты - Senior Vue 3 Developer.
    Рабочая директория: ${targetPath}
    Файлы в директории: ${filesInProject.join(", ")}.
    Задача пользователя: ${state.task}.
    
    Составь план действий.
    Используй 'gemini' для кода и 'terminal' для команд.
    Внимание: В поле 'file' указывай просто имя файла (например "About.vue"), без путей.
  `;

  const response = await structuredModel.invoke(prompt);
  
  return { 
    files: filesInProject,
    plan: response.steps.map(s => JSON.stringify(s)) 
  };
}