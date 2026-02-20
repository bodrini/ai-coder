import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "./state";
import { plannerNode } from "./nodes/plannerNode";
import { executorNode } from "./nodes/executorNode";
import { validatorNode } from "./nodes/validatorNode";

// 🛑 КОНСТАНТА: Максимальное количество попыток исправления
const MAX_RETRIES = 3;

/**
 * Определяет, нужно ли продолжать работу после валидации
 */
function shouldContinue(state: typeof AgentState.State) {
  const { plan, error, lintErrors, retryCount } = state;
  const retries = retryCount || 0;

  // 1. ПРОВЕРКА НА ОШИБКИ (Системные или Линтера)
  if (error || lintErrors) {
    if (retries < MAX_RETRIES) {
        console.log(`🚨 НАЙДЕНЫ ОШИБКИ (Попытка ${retries + 1}/${MAX_RETRIES}).`);
        console.log(lintErrors ? "Причина: Ошибка валидации кода." : `Причина: ${error}`);
        return "planner"; // Возвращаемся в планировщик, чтобы он учел ошибку
    } else {
        console.error(`💀 ПРЕВЫШЕН ЛИМИТ ПОПЫТОК. Агент останавливается.`);
        return END;
    }
  }

  // 2. ЕСЛИ В ПЛАНЕ ЕЩЕ ЕСТЬ ШАГИ -> к Исполнителю
  if (plan && plan.length > 0) {
    return "executor";
  }

  // 3. ВСЕ ЗАДАЧИ ВЫПОЛНЕНЫ И ОШИБОК НЕТ
  console.log("🏁 Все задачи выполнены успешно и проверены линтером.");
  return END;
}

const workflow = new StateGraph(AgentState)
  .addNode("planner", plannerNode)
  .addNode("executor", executorNode)
  .addNode("validator", validatorNode) // 👈 Добавляем узел валидации

  .addEdge(START, "planner")
  .addEdge("planner", "executor") // После плана идем к исполнителю (тут сработает пауза)
  
  // 🔥 ПОСЛЕ ИСПОЛНЕНИЯ ВСЕГДА ИДЕМ В ВАЛИДАТОР
  .addEdge("executor", "validator") 

  // 🔀 А УЖЕ ВАЛИДАТОР РЕШАЕТ ЧТО ДЕЛАТЬ ДАЛЬШЕ
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

// 3. Компилируем с прерыванием ПЕРЕД исполнителем
export const app = workflow.compile({
  checkpointer, 
  interruptBefore: ["executor"] // 🛑 Пауза для Human-in-the-Loop перед записью кода
});