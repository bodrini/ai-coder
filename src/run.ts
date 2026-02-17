import { app } from "./agent/index";
import path from "path";
import fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {

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
    retryCount: 0
  };

  try {
    const result = await app.invoke(inputs);
    console.log("\n🏁 Готово! Агент завершил работу.");
  } catch (error) {
    console.error("\n💥 Произошла ошибка при выполнении:", error);
  }
}

main();