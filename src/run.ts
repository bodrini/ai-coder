import { app } from "./agent/index";
import path from "path";
import fs from "fs";
import * as dotenv from "dotenv";
import { setupLogger } from "./agent/utils/logger";

dotenv.config();

function getHistoryPath(targetFolder: string) {
  return path.join(targetFolder, ".agent", "history.md");
}

async function main() {

  setupLogger();
  const targetFolder = process.env.TARGET_PROJECT_PATH || process.cwd();
  const taskFilePath = path.join(process.cwd(), "task.md");

  // 1. Проверяем, есть ли файл с задачей
  if (!fs.existsSync(taskFilePath)) {
    console.error("❌ Ошибка: Файл task.md не найден в корне проекта!");
    console.error("Создай файл task.md и напиши туда задачу.");
    process.exit(1);
  }

  // 2. Читаем задачу из файла
  const userTask = fs.readFileSync(taskFilePath, "utf-8").trim();

  const historyFile = getHistoryPath(targetFolder);
  let projectHistory = "Это первый запуск агента.";

  if (fs.existsSync(historyFile)) {
    projectHistory = fs.readFileSync(historyFile, "utf-8");
    console.log("🧠 История проекта загружена.");
  }

  if (!userTask) {
    console.error("❌ Ошибка: Файл task.md пустой!");
    process.exit(1);
  }

  console.log("\n🤖 **AI VUE AGENT ЗАПУЩЕН**");
  console.log(`📂 Рабочая директория: ${targetFolder}`);
  console.log("-----------------------------------");
  console.log(`📝 Задача из файла:\n${userTask}`);
  console.log("-----------------------------------\n");

  const inputs = {
    workDir: targetFolder, 
    task: userTask, // <-- Передаем содержимое файла
    plan: [],
    files: [],
    retryCount: 0,
    memory: projectHistory, // Загружаем историю проекта, если она есть
  };

  try {
    const result = await app.invoke(inputs);

    // 4. ЕСЛИ УСПЕХ -> СОХРАНЯЕМ В ИСТОРИЮ
    console.log("\n💾 Сохраняю результат в память...");
    
    const agentDir = path.dirname(historyFile);
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const newEntry = `\n## [${timestamp}] Задача\n${userTask}\nStatus: ✅ Completed\n`;

    fs.appendFileSync(historyFile, newEntry);
    console.log(`✅ История обновлена: ${historyFile}`); 
    console.log("\n🏁 Готово! Агент завершил работу.");

  } catch (error) {
    console.error("\n💥 Произошла ошибка при выполнении:", error);
  }
}

main();