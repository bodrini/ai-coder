import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "./state";
import { plannerNode } from "./nodes/plannerNode";
import { executorNode } from "./nodes/executorNode";
import { validatorNode } from "./nodes/validatorNode";
import { loadAgentConfig } from "./utils/configLoader";
import * as path from "path";

// 🛑 КОНСТАНТА: Максимальное количество попыток исправления
const MAX_RETRIES = 3;

/**
 * Определяет логику переходов: продолжать выполнение, исправлять ошибки или закончить.
 */
function shouldContinue(state: typeof AgentState.State) {
  const { plan, error, lintErrors, retryCount } = state;
  const retries = retryCount || 0;

  // 1. ПРОВЕРКА НА ОШИБКИ (Системные или Линтера)
  if (error || lintErrors) {
    if (retries < MAX_RETRIES) {
        console.log(`🚨 [Retry] Обнаружена проблема (Попытка ${retries + 1}/${MAX_RETRIES}).`);
        return "planner"; // Возвращаемся в планировщик для пересмотра стратегии
    } else {
        console.error(`💀 [Critical] Превышен лимит попыток исправления.`);
        return END;
    }
  }

  // 2. ЕСЛИ В ПЛАНЕ ЕЩЕ ЕСТЬ ШАГИ -> к Исполнителю
  if (plan && plan.length > 0) {
    return "executor";
  }

  // 3. ВСЕ ЗАДАЧИ ВЫПОЛНЕНЫ
  console.log("✅ [Done] Все задачи выполнены успешно и прошли валидацию.");
  return END;
}

// Сборка графа
const workflow = new StateGraph(AgentState)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addNode("validator", validatorNode)

  .addEdge(START, "planner")
  .addEdge("planner", "executor") 
  .addEdge("executor", "validator") 

  .addConditionalEdges(
    "validator",
    shouldContinue,
    {
      planner: "planner",
      executor: "executor",
      [END]: END
    }
  );

const checkpointer = new MemorySaver();

export const app = workflow.compile({
  checkpointer, 
  interruptBefore: ["executor"] // Пауза для подтверждения плана человеком
});

/**
 * ТОЧКА ВХОДА
 */
async function run() {
  // Получаем путь к проекту: npm start ../my-cool-project
  const targetDir = process.argv[2];
  const userTask = process.argv[3] || "Проанализируй проект и проверь его на ошибки";

  if (!targetDir) {
    console.error("❌ Ошибка: Укажите путь к целевому проекту первым аргументом.");
    process.exit(1);
  }

  const workDir = path.resolve(targetDir);
  
  // 📂 Загружаем конфиг (локальный или глобальный)
  const config = loadAgentConfig(workDir);
  
  console.log(`\n🤖 Агент инициализирован`);
  console.log(`📍 Проект: ${workDir}`);
  console.log(`🎭 Роль: ${config.role}`);
  console.log(`🛠 Стек: ${config.techStack.join(", ")}\n`);

  const configState = {
    configurable: { thread_id: "session_" + Date.now() }
  };

  // Начальное состояние
  const initialState = {
    task: userTask,
    workDir: workDir,
    config: config, // Пробрасываем загруженный конфиг в стейт
    plan: [],
    retryCount: 0,
    context: "",
    error: null,
    lintErrors: null,
    isValidated: false
  };

  // Запуск цикла
  // Примечание: так как стоит interruptBefore, здесь может потребоваться 
  // дополнительная логика возобновления (resume) после подтверждения в CLI.
  await app.invoke(initialState, configState);
}

// Запуск, если файл вызван напрямую
if (require.main === module) {
  run().catch(console.error);
}