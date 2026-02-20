import { Annotation } from "@langchain/langgraph";

// Определяем, что агент будет помнить в процессе работы
export const AgentState = Annotation.Root({
  task: Annotation<string>(),      // Твоя команда (напр. "добавь кнопку")
  files: Annotation<string[]>(),   // Список файлов, которые он нашел
  plan: Annotation<string[]>(),    // Список шагов, который он составил
  currentCode: Annotation<string>(), // Код, с которым работаем сейчас
  workDir: Annotation<string>(),   // <-- Путь к папке, которую мы редактируем
  context: Annotation<string>({
    reducer: (current, update) => current + "\n\n" + update,
    default: () => "",
  }),
  error: Annotation<string>(),
  // 🔥 НОВЫЕ ПОЛЯ ДЛЯ ВАЛИДАЦИИ
  lintErrors: Annotation<string | null>({
    reducer: (x, y) => y,
    default: () => null,
  }),

  isValidated: Annotation<boolean>({
    reducer: (x, y) => y,
    default: () => false,
  }),
  retryCount: Annotation<number>({
    reducer: (current, update) => update,
    default: () => 0,
  }),
  memory: Annotation<string>({
    reducer: (current, update) => update, // Просто перезаписываем при старте
    default: () => "История пуста.",
  }),
}); 