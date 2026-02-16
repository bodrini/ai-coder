import { app } from "./agent/index";
import path from "path";

async function main() {
  // 1. Указываем путь ГЛУБЖЕ, прямо к компонентам
  // Так агент увидит другие файлы (HomeView, AboutView) и поймет контекст
  const targetFolder = "/Users/ib/Desktop/teams-ui/src/views"; 
  // (или src/components, смотря где у тебя лежат файлы)

  const inputs = {
    workDir: targetFolder, 
    
    // 2. Уточняем задачу, чтобы он не запутался
    task: "Проверь, есть ли файл StatsView.vue. Если нет - создай его. Внутри сделай <template> с заголовком 'Statistics' и пустой таблицей.",
    
    plan: [],
    files: []
  };

  console.log(`🚀 Запускаем агента...`);
  console.log(`📂 Рабочая папка: ${targetFolder}`);
  
  try {
    const result = await app.invoke(inputs);
    console.log("✅ Готово! Проверяй папку.");
  } catch (e) {
    console.error("💥 Ошибка:", e);
  }
}

main();