import * as dotenv from "dotenv";

// Загружаем переменные из .env
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;

async function listModels() {
  if (!API_KEY) {
    console.error("❌ ОШИБКА: Не найден GEMINI_API_KEY в файле .env");
    return;
  }

  console.log("🔍 Запрашиваю список моделей у Google...");

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error("❌ Ошибка API:", data.error.message);
      return;
    }

    if (!data.models) {
      console.log("⚠️ Модели не найдены.");
      return;
    }

    console.log("\n✅ ДОСТУПНЫЕ МОДЕЛИ (generateContent):");
    console.log("-----------------------------------------");
    
    // Фильтруем модели, которые умеют генерировать контент
    const contentModels = data.models.filter((m: any) => 
      m.supportedGenerationMethods.includes("generateContent")
    );

    contentModels.forEach((model: any) => {
      // Убираем префикс "models/", чтобы получить чистой имя
      const cleanName = model.name.replace("models/", "");
      console.log(`🔹 ${cleanName}`);
    });

    console.log("-----------------------------------------");
    console.log("Скопируй одно из имен выше (например, gemini-1.5-flash) и вставь в plannerNode.ts и executorNode.ts");

  } catch (error) {
    console.error("💥 Ошибка сети:", error);
  }
}

listModels();