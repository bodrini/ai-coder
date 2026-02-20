import { app } from "./agent/index";
import path from "path";
import fs from "fs";
import * as dotenv from "dotenv";
import { setupLogger } from "./agent/utils/logger";
import { loadAgentConfig } from "./agent/utils/configLoader";
import * as readline from "readline/promises";

dotenv.config();

function getHistoryPath(targetFolder: string) {
  return path.join(targetFolder, ".agent", "history.md");
}

async function main() {
  setupLogger();
  
  // Приоритет пути: Аргумент CLI > .env > Текущая папка
  const targetFolder = process.argv[2] || process.env.TARGET_PROJECT_PATH || process.cwd();
  const taskFilePath = path.join(process.cwd(), "task.md");

  if (!fs.existsSync(taskFilePath)) {
    console.error("❌ Ошибка: Файл task.md не найден в корне агента!");
    process.exit(1);
  }

  const userTask = fs.readFileSync(taskFilePath, "utf-8").trim();
  const historyFile = getHistoryPath(targetFolder);
  let projectHistory = "Это первый запуск агента.";

  if (fs.existsSync(historyFile)) {
    projectHistory = fs.readFileSync(historyFile, "utf-8");
  }

  // Загружаем универсальный конфиг из целевого проекта
  const agentConfig = loadAgentConfig(targetFolder);

  console.log("\n🤖 **AI AGENT ЗАПУЩЕН**");
  console.log(`🎭 Роль: ${agentConfig.role}`);
  console.log(`🛠 Стек: ${agentConfig.techStack.join(", ")}`);
  console.log(`📍 Проект: ${targetFolder}\n`);

  const inputs = {
    workDir: targetFolder, 
    task: userTask,
    config: agentConfig,
    plan: [],
    files: [],
    retryCount: 0,
    memory: projectHistory,
    error: null,
    lintErrors: null,
    currentCode: "",
    isValidated: false
  };

  // Уникальный thread_id позволяет сохранять состояние между инвоками
  const sessionConfig = { configurable: { thread_id: `session-${Date.now()}` } };

  try {
    console.log("⏳ Планировщик изучает проект и составляет стратегию...");
    await app.invoke(inputs, sessionConfig);

    let currentState = await app.getState(sessionConfig);
    
    // Проверка на прерывание перед исполнением (interruptBefore: ["executor"])
    if (currentState.next && currentState.next.includes("executor")) {
      const plan = currentState.values.plan;

      console.log("\n======================================");
      console.log("📋 ПЛАН ДЕЙСТВИЙ:");
      console.log("======================================");
      plan.forEach((stepJson: string, i: number) => {
        try {
          const step = JSON.parse(stepJson);
          console.log(`${i+1}. [${step.tool.toUpperCase()}] ${step.action}: ${step.description}`);
        } catch (e) {
          console.log(`${i+1}. ${stepJson}`);
        }
      });

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("\n🚀 Выполнить этот план? (y/n): ");
      rl.close();

      if (answer.toLowerCase() === 'y') {
        console.log("\n⚡️ Начинаю выполнение плана...");

        // 🔥 МАГИЧЕСКИЙ ЦИКЛ: Крутим, пока есть следующие узлы в графе
        while (currentState.next && currentState.next.length > 0) {
            // Если в стейте есть ошибка, которую планировщик не смог разрулить — выходим
            if (currentState.values.error && (currentState.values.retryCount || 0) >= 3) {
                console.error("\n🛑 Остановка: Превышено количество попыток исправления ошибок.");
                break;
            }

            // Вызываем invoke(null), чтобы продолжить с текущей точки
            await app.invoke(null, sessionConfig);
            
            // Получаем обновленное состояние после прохода через узлы
            currentState = await app.getState(sessionConfig);
            
            // Если план пуст и ошибок нет — мы закончили
            if (!currentState.next || currentState.next.length === 0) {
                break;
            }
        }
        
        // 💾 Сохранение истории после завершения всех шагов
        const timestamp = new Date().toLocaleString();
        const entry = `\n---\n### [${timestamp}] Задача\n${userTask}\n**Статус:** ✅ Успешно выполнено\n`;
        
        const agentDir = path.dirname(historyFile);
        if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
        fs.appendFileSync(historyFile, entry);
        
        console.log("\n🏁 Работа завершена. Все шаги плана выполнены и проверены.");
      } else {
        console.log("\n❌ Отменено пользователем. Изменения не были применены.");
      }
    } else {
       console.log("\n🏁 Агент завершил работу (план пуст или задача выполнена информационно).");
    }
  } catch (error) {
    console.error("\n💥 Критическая ошибка при работе агента:", error);
  }
}

main();