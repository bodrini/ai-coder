import fs from "fs";
import path from "path";
import util from "util";

/**
 * Функция для очистки ANSI-цветов (чтобы файл лога был чистым)
 */
function stripAnsi(str: string): string {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

export function setupLogger() {
  // 1. Создаем папку logs, если её нет
  const logDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }

  // 2. Генерируем имя файла с текущей датой и временем
  // Пример: run-2023-10-27_14-30-55.log
  const now = new Date();
  const timestamp = now.toISOString().replace(/T/, "_").replace(/\..+/, "").replace(/:/g, "-");
  const logFilePath = path.join(logDir, `run-${timestamp}.log`);

  // Открываем поток для записи (flags: 'a' - append)
  const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  // 3. Сохраняем оригинальные функции консоли
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);

  // 4. Перехватываем stdout (console.log)
  process.stdout.write = (chunk: any, encoding?: any, cb?: any) => {
    // Пишем в файл (без цветов)
    const stringChunk = String(chunk);
    logStream.write(stripAnsi(stringChunk));
    
    // Пишем в терминал (как обычно, с цветами)
    return originalStdout(chunk, encoding, cb);
  };

  // 5. Перехватываем stderr (console.error)
  process.stderr.write = (chunk: any, encoding?: any, cb?: any) => {
    const stringChunk = String(chunk);
    logStream.write(`[ERROR] ${stripAnsi(stringChunk)}`);
    return originalStderr(chunk, encoding, cb);
  };

  console.log(`📝 Логирование включено. Файл: logs/${path.basename(logFilePath)}`);
  
  return logFilePath;
}