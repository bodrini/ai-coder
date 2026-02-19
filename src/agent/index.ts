import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "./state";
import { plannerNode } from "./nodes/plannerNode";
import { executorNode } from "./nodes/executorNode";

// 🛑 КОНСТАНТА: Максимальное количество попыток исправления
const MAX_RETRIES = 3;

function shouldContinue(state: typeof AgentState.State) {
  const { plan, error, retryCount } = state;

  // 1. ЕСТЬ ОШИБКА?
  if (error) {
    const retries = retryCount || 0;
    
    // Проверяем лимит
    if (retries <= MAX_RETRIES) {
        console.log(`🚨 ОШИБКА (Попытка ${retries}/${MAX_RETRIES}). Возврат к планированию...`);
        return "planner"; // Пробуем исправить
    } else {
        console.error(`💀 ПРЕВЫШЕН ЛИМИТ ПОПЫТОК (${retries}). Агент останавливается.`);
        return END; // Сдаемся
    }
  }

  // 2. ЕСТЬ ЗАДАЧИ -> К ИСПОЛНИТЕЛЮ
  if (plan && plan.length > 0) {
    return "executor";
  }

  // 3. ВСЕ ЧИСТО -> КОНЕЦ
  return END;
}

const workflow = new StateGraph(AgentState)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addEdge(START, "planner")
  .addEdge("planner", "executor")
  .addConditionalEdges(
    "executor",
    shouldContinue,
    ["planner", "executor", END]
  );

  const checkpointer = new MemorySaver();

  // 3. Компилируем с прерыванием ПЕРЕД исполнителем
  export const app = workflow.compile({
    checkpointer, // Подключаем память
    interruptBefore: ["executor"] // 🛑 Граф встанет на паузу ПЕРЕД этим узлом
  });