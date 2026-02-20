import * as fs from 'fs';
import * as path from 'path';

export interface AgentConfig {
  projectType: string;
  role: string;
  linterCommand: string;
  contextFiles: string[];
  techStack: string[];
  rules: string[];
}

const defaultConfig: AgentConfig = {
  projectType: "Generic",
  role: "Senior Software Engineer",
  linterCommand: "npx tsc --noEmit",
  contextFiles: ["src"],
  techStack: ["TypeScript", "Node.js"],
  rules: []
};

export function loadAgentConfig(targetWorkDir?: string): AgentConfig {
  // 1. Пытаемся найти локальный конфиг в целевом проекте
  const localConfigPath = targetWorkDir ? path.join(targetWorkDir, 'agent.config.json') : null;
  // 2. Глобальный конфиг в папке самого агента
  const globalConfigPath = path.join(process.cwd(), 'agent.config.json');

  let configToLoad: string | null = null;

  if (localConfigPath && fs.existsSync(localConfigPath)) {
    console.log("📂 [Config] Обнаружен локальный конфиг проекта. Загружаю...");
    configToLoad = localConfigPath;
  } else if (fs.existsSync(globalConfigPath)) {
    console.log("🌍 [Config] Локальный конфиг не найден. Использую глобальные настройки.");
    configToLoad = globalConfigPath;
  }

  if (configToLoad) {
    try {
      const fileContent = fs.readFileSync(configToLoad, 'utf-8');
      return { ...defaultConfig, ...JSON.parse(fileContent) };
    } catch (e) {
      console.error("⚠️ Ошибка при чтении конфига, использую default:", e);
    }
  }

  return defaultConfig;
}