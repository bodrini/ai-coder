import fs from "fs";
import path from "path";

export function loadPrompt(fileName: string, variables: Record<string, string>): string {
  try {
    // Ищем папку prompts в корне проекта (где лежит package.json)
    const promptsDir = path.join(process.cwd(), "prompts");
    const filePath = path.join(promptsDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Файл промпта не найден: ${filePath}`);
    }

    let content = fs.readFileSync(filePath, "utf-8");

    // Заменяем все вхождения {{key}} на значения
    for (const [key, value] of Object.entries(variables)) {
      // Флаг 'g' означает "заменить везде", а не только первое вхождение
      content = content.replace(new RegExp(`{{${key}}}`, "g"), value || "");
    }

    return content;
  } catch (error) {
    console.error(`❌ Ошибка загрузки промпта ${fileName}:`, error);
    // Возвращаем пустую строку или выбрасываем ошибку дальше
    throw error;
  }
}