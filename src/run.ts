import { app } from "./agent/index";
import path from "path";
import fs from "fs";
import * as dotenv from "dotenv";
import { setupLogger } from "./agent/utils/logger";
import * as readline from "readline/promises"; // 👈 Импортируем для запроса в консоли

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
    process.exit(1);
  }

  // 2. Читаем задачу из файла
  const userTask = fs.readFileSync(taskFilePath, "utf-8").trim();

  if (!userTask) {
    console.error("❌ Ошибка: Файл task.md пустой!");
    process.exit(1);
  }

  // 3. Работа с историей
  const historyFile = getHistoryPath(targetFolder);
  let projectHistory = "Это первый запуск агента.";

  if (fs.existsSync(historyFile)) {
    projectHistory = fs.readFileSync(historyFile, "utf-8");
    console.log("🧠 История проекта загружена.");
  }

  console.log("\n🤖 **AI VUE AGENT ЗАПУЩЕН**");
  console.log(`📂 Рабочая директория: ${targetFolder}`);
  console.log("-----------------------------------");
  console.log(`📝 Задача из файла:\n${userTask}`);
  console.log("-----------------------------------\n");

  const inputs = {
    workDir: targetFolder, 
    task: userTask,
    plan: [],
    files: [],
    retryCount: 0,
    memory: projectHistory,
  };

  // 🔥 КОНФИГ СЕССИИ (Обязателен для прерываний LangGraph)
  // Используем Date.now(), чтобы каждый запуск был новой независимой сессией
  const config = { configurable: { thread_id: `agent-session-${Date.now()}` } };

  try {
    console.log("⏳ Планировщик изучает проект и составляет план...");
    
    // Шаг 1: Запускаем граф. Он остановится ПЕРЕД узлом "executor"
    await app.invoke(inputs, config);

    // Шаг 2: Получаем текущее состояние (после остановки)
    let currentState = await app.getState(config);
    const nextNode = currentState.next;

    // Шаг 3: Проверяем, действительно ли мы стоим на паузе перед Исполнителем
    if (nextNode && nextNode.includes("executor")) {
      const plan = currentState.values.plan;

      // Выводим план
      console.log("\n======================================");
      console.log("📋 СГЕНЕРИРОВАННЫЙ ПЛАН:");
      console.log("======================================");
      
      plan.forEach((stepJson: string, index: number) => {
        try {
          const step = JSON.parse(stepJson);
          console.log(`Шаг ${index + 1}: [${step.tool.toUpperCase()}] -> ${step.action} ${step.file ? `(${step.file})` : ''}`);
          console.log(`   📝 Описание: ${step.description}\n`);
        } catch (e) {
          console.log(`Шаг ${index + 1}: ${stepJson}`);
        }
      });

      // Спрашиваем пользователя
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("🚀 Выполнить этот план? (y - да, n - отмена): ");
      rl.close();

      if (answer.toLowerCase() === 'y') {
        console.log("\n⚡️ План утвержден. Начинаю выполнение...");
        
        // 🔥 МАГИЧЕСКИЙ ЦИКЛ 🔥
        // Крутим invoke(null), пока граф не завершит все оставшиеся шаги (пока не опустеет next)
        while (currentState.next && currentState.next.length > 0) {
            await app.invoke(null, config); // Передаем null, так как inputs уже в стейте
            currentState = await app.getState(config); // Обновляем состояние для проверки
        }
        
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
        
        console.log("\n🏁 Готово! Агент успешно завершил работу.");
      } else {
        console.log("\n❌ Выполнение отменено пользователем. Граф остановлен.");
      }
    } else {
       // Если план пустой или Планировщик сам завершил работу с ошибкой
       console.log("\n🏁 Агент завершил работу до этапа выполнения (возможно, план пуст или произошла ошибка).");
    }

  } catch (error) {
    console.error("\n💥 Произошла ошибка при выполнении:", error);
  }
}

main();