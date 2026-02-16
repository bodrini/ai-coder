import { app } from "./agent/index";
import path from "path";
import fs from "fs";

async function main() {
  // Целимся в корень src, чтобы агент видел и views, и router
  const targetFolder = path.join(process.cwd(), "src");

  // Убедимся, что папки существуют, чтобы агент не упал сразу
  if (!fs.existsSync(path.join(targetFolder, "views"))) {
    console.error("❌ Ошибка: В папке src нет папки views!");
    return;
  }

  const inputs = {
    workDir: targetFolder, 
    
    // 🔥 СЛОЖНАЯ ЗАДАЧА:
    task: `
      1. Изучи файл App.vue (или любой другой во views).
      2. Создай новый компонент 'views/SystemStatus.vue'. 
      3. Сделай его визуально похожим на изученный файл, но заголовок: 'System Online'.
      4. Добавь этот компонент в 'router/index.ts' по пути '/status'.
    `,
    
    plan: [],
    files: [],
    retryCount: 0 // Начинаем с нуля
  };

  console.log(`🚀 ЗАПУСК АГЕНТА...`);
  console.log(`📂 Рабочая папка: ${targetFolder}\n`);

  try {
    const result = await app.invoke(inputs);
    console.log("\n🏁 АГЕНТ ЗАВЕРШИЛ РАБОТУ!");
    console.log("Проверяй: src/views/SystemStatus.vue и src/router/index.ts");
  } catch (error) {
    console.error("\n💥 Критическая ошибка:", error);
  }
}

main();