import { Annotation } from "@langchain/langgraph";

// Определяем, что агент будет помнить в процессе работы
export const AgentState = Annotation.Root({
  task: Annotation<string>(),      // Твоя команда (напр. "добавь кнопку")
  files: Annotation<string[]>(),   // Список файлов, которые он нашел
  plan: Annotation<string[]>(),    // Список шагов, который он составил
  currentCode: Annotation<string>(), // Код, с которым работаем сейчас
  workDir: Annotation<string>(),   // <-- Путь к папке, которую мы редактируем
}); 