import fs from "fs";
import path from "path";
import crypto from "crypto";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { loadAgentConfig } from "./configLoader"; // 👈 ИМПОРТ КОНФИГА

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

function getFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  return crypto.createHash("md5").update(content).digest("hex");
}

// 👈 УЛУЧШЕННЫЙ РЕКУРСИВНЫЙ ОБХОД
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;

  const files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      // Игнорируем стандартные папки артефактов
      if (!["node_modules", ".git", ".agent", "dist", "build", "__pycache__"].includes(file) && !file.startsWith(".")) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      // 👈 УНИВЕРСАЛЬНЫЙ СПИСОК РАСШИРЕНИЙ
      const validExtensions = [".vue", ".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".json", ".md"];
      if (validExtensions.includes(path.extname(file))) {
        arrayOfFiles.push(fullPath);
      }
    }
  });
  return arrayOfFiles;
}

export async function getContextViaRAG(workDir: string, task: string): Promise<string> {
  const agentDir = path.join(workDir, ".agent");
  const cachePath = path.join(agentDir, "rag-cache.json");
  
  // 👈 ЗАГРУЗКА КОНФИГА
  const config = loadAgentConfig(workDir);

  if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });

  let cache: RagCache = {};
  if (fs.existsSync(cachePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    } catch (e) {
      cache = {};
    }
  }

  const embeddingsModel = new HuggingFaceTransformersEmbeddings({
    model: "Xenova/all-MiniLM-L6-v2",
  });

  // 👈 СБОР ФАЙЛОВ ИЗ ВСЕХ ПАПОК КОНФИГА
  let allFiles: string[] = [];
  config.contextFiles.forEach(folder => {
    const targetPath = path.join(workDir, folder);
    if (fs.existsSync(targetPath)) {
      // Если в конфиге указан конкретный файл, а не папка
      if (fs.statSync(targetPath).isFile()) {
        allFiles.push(targetPath);
      } else {
        allFiles = getAllFiles(targetPath, allFiles);
      }
    }
  });

  const newCache: RagCache = {};
  let updatedFilesCount = 0;

  console.log(`🔍 [RAG] Сканирование директорий: ${config.contextFiles.join(", ")}...`);

  for (const file of allFiles) {
    const relativePath = path.relative(workDir, file);
    const currentHash = getFileHash(file);

    if (cache[relativePath] && cache[relativePath].hash === currentHash) {
      newCache[relativePath] = cache[relativePath];
      continue;
    }

    updatedFilesCount++;
    const content = fs.readFileSync(file, "utf-8");
    const doc = new Document({ pageContent: content, metadata: { source: relativePath } });

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const splittedDocs = await splitter.splitDocuments([doc]);

    const chunksData: { pageContent: string; metadata: any; vector: number[] }[] = [];
    for (const chunk of splittedDocs) {
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

  fs.writeFileSync(cachePath, JSON.stringify(newCache));

  if (updatedFilesCount > 0) {
    console.log(`✅ [RAG] Обновлены векторы для ${updatedFilesCount} файлов.`);
  }

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

  if (allDocuments.length === 0) return "Кодовая база пуста в указанных директориях.";

  const vectorStore = new MemoryVectorStore(embeddingsModel);
  await vectorStore.addVectors(allVectors, allDocuments);

  console.log("🔍 [RAG] Поиск контекста...");
  const results = await vectorStore.similaritySearch(task, 4); // Увеличил до 4 для большего контекста

  let contextStr = "";
  results.forEach((res, i) => {
    contextStr += `\n--- ФРАГМЕНТ ${i + 1} [ФАЙЛ: ${res.metadata.source}] ---\n${res.pageContent}\n`;
  });

  return contextStr;
}