import fs from "fs";
import path from "path";
import crypto from "crypto";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";

// Типы для нашего локального кэша
interface CacheEntry {
  hash: string;
  chunks: {
    pageContent: string;
    metadata: any;
    vector: number[];
  }[];
}

type RagCache = Record<string, CacheEntry>;

// 1. Утилита для получения MD5 хэша файла
function getFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  return crypto.createHash("md5").update(content).digest("hex");
}

// 2. Рекурсивный обход папок
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;

  const files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      // Игнорируем ненужные папки
      if (file !== "node_modules" && !file.startsWith(".")) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      // Берем только код
      if (file.endsWith(".vue") || file.endsWith(".ts") || file.endsWith(".js")) {
        arrayOfFiles.push(fullPath);
      }
    }
  });
  return arrayOfFiles;
}

export async function getContextViaRAG(workDir: string, task: string): Promise<string> {
  const agentDir = path.join(workDir, ".agent");
  const cachePath = path.join(agentDir, "rag-cache.json");
  const srcPath = path.join(workDir, "src");

  if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

  // 1. Загружаем кэш с диска
  let cache: RagCache = {};
  if (fs.existsSync(cachePath)) {
    cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  }

  const embeddingsModel = new HuggingFaceTransformersEmbeddings({
    model: "Xenova/all-MiniLM-L6-v2", // Легкая и очень быстрая модель
  });

  const allFiles = getAllFiles(srcPath);
  const newCache: RagCache = {};
  let updatedFilesCount = 0;

  console.log("🔍 [RAG] Проверка изменений в кодовой базе...");

  // 2. Проходим по всем файлам и сверяем дифф
  for (const file of allFiles) {
    const relativePath = file.replace(workDir + "/", "");
    const currentHash = getFileHash(file);

    // Если файл не менялся — берем из кэша
    if (cache[relativePath] && cache[relativePath].hash === currentHash) {
      newCache[relativePath] = cache[relativePath];
      continue;
    }

    // Если файл новый или изменился — обрабатываем
    updatedFilesCount++;
    const content = fs.readFileSync(file, "utf-8");
    const doc = new Document({ pageContent: content, metadata: { source: relativePath } });

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const splittedDocs = await splitter.splitDocuments([doc]);

    // Получаем векторы для новых чанков через API
    const chunksData: { pageContent: string; metadata: any; vector: number[] }[] = [];    for (const chunk of splittedDocs) {
      const vector = await embeddingsModel.embedQuery(chunk.pageContent);
      chunksData.push({
        pageContent: chunk.pageContent,
        metadata: chunk.metadata,
        vector: vector
      });
    }

    newCache[relativePath] = {
      hash: currentHash,
      chunks: chunksData
    };
  }

  // 3. Сохраняем обновленный кэш (удаленные файлы исчезнут автоматически, так как их нет в newCache)
  fs.writeFileSync(cachePath, JSON.stringify(newCache));

  if (updatedFilesCount > 0) {
    console.log(`✅ [RAG] Обновлены векторы для ${updatedFilesCount} файлов.`);
  } else {
    console.log(`⚡️ [RAG] Изменений нет. Загрузка из кэша.`);
  }

  // 4. Собираем все векторы и документы для поиска
  const allVectors: number[][] = [];
  const allDocuments: Document[] = [];

  for (const fileData of Object.values(newCache)) {
    for (const chunk of fileData.chunks) {
      allVectors.push(chunk.vector);
      allDocuments.push(new Document({
        pageContent: chunk.pageContent,
        metadata: chunk.metadata
      }));
    }
  }

  if (allDocuments.length === 0) return "Кодовая база пуста.";

  // 5. Загружаем в быструю память и ищем
  const vectorStore = new MemoryVectorStore(embeddingsModel);
  await vectorStore.addVectors(allVectors, allDocuments);

  console.log("🔍 [RAG] Ищем релевантный код под задачу...");
  const results = await vectorStore.similaritySearch(task, 3);

  let contextStr = "";
  results.forEach((res, i) => {
    contextStr += `\n--- ФРАГМЕНТ ${i + 1} ИЗ ФАЙЛА: ${res.metadata.source} ---\n${res.pageContent}\n`;
  });

  return contextStr;
}