import { Annotation } from "@langchain/langgraph";
import { AgentConfig } from "./utils/configLoader"; 

export const AgentState = Annotation.Root({
  task: Annotation<string>(),
  files: Annotation<string[]>(),
  plan: Annotation<string[]>(),
  currentCode: Annotation<string>(),
  workDir: Annotation<string>(),
  
  context: Annotation<string>({
    reducer: (current, update) => current + "\n\n" + update,
    default: () => "",
  }),

  config: Annotation<AgentConfig>({
    reducer: (current, update) => update,
    default: () => ({
      projectType: "Generic",
      role: "Senior Engineer",
      linterCommand: "",
      contextFiles: ["src"],
      techStack: [],
      rules: []
    })
  }),

  // Исправлено: добавили nullable и default
  error: Annotation<string | null>({
    reducer: (x, y) => y,
    default: () => null,
  }),

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
    reducer: (current, update) => update,
    default: () => "История пуста.",
  }),
});