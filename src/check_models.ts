import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

async function listModels() {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    // Получаем список моделей
    // Внимание: мы используем getGenerativeModel, но для листинга нужен прямой запрос или перебор
    // Проще попробовать вызвать стандартную gemini-pro, чтобы проверить связь
    
    console.log("Проверяем ключ...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-001" });
    
    const result = await model.generateContent("Hello");
    console.log("✅ Модель gemini-1.5-flash-001 РАБОТАЕТ!");
    console.log("Ответ:", result.response.text());

  } catch (error: any) {
    console.error("\n❌ Ошибка доступа к модели:");
    console.error(error.message);
    
    console.log("\nПробуем запасной вариант (gemini-pro)...");
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        await model.generateContent("Hello");
        console.log("✅ gemini-pro РАБОТАЕТ! Используй это имя.");
    } catch (e) {
        console.log("❌ gemini-pro тоже не работает. Проверь API Key.");
    }
  }
}

listModels();