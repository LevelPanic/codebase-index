import fs from "fs";
import { loadConfig } from "../../config/loader.js";
import { listIndexableFiles, readFile, fileExists } from "../../utils/files.js";
import { getCurrentCommit, getChangedFilesSince } from "../../utils/git.js";
import { chunkFile } from "../../parsers/chunker.js";
import { inferTags } from "../../tags/tagger.js";
import { hashContent } from "../../freshness/file-hash.js";
import { healthCheck } from "../../embedding/ollama.js";
import { embedChunks, type ChunkWithVector } from "../../embedding/batch.js";
import {
  createTable,
  upsertChunks,
  deleteByFiles,
} from "../../storage/lancedb.js";

interface IndexMeta {
  lastCommit: string;
  lastIndexed: string;
  totalFiles: number;
  totalChunks: number;
}

function readMeta(metaFile: string): IndexMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaFile, "utf-8"));
  } catch {
    return null;
  }
}

function writeMeta(metaFile: string, meta: IndexMeta): void {
  fs.mkdirSync(
    metaFile.substring(0, metaFile.lastIndexOf("/")),
    { recursive: true },
  );
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
}

export async function indexCommand(opts: { full?: boolean }) {
  const config = loadConfig();

  const healthy = await healthCheck(
    config.embedding.url,
    config.embedding.model,
  );
  if (!healthy) {
    console.error(
      `Ollama is not running or ${config.embedding.model} is not available.`,
    );
    console.error(
      `Run: ollama serve && ollama pull ${config.embedding.model}`,
    );
    process.exit(1);
  }

  if (opts.full) {
    await fullIndex(config);
  } else {
    const meta = readMeta(config.metaFile);
    if (!meta) {
      console.log("No existing index found. Running full index...");
      await fullIndex(config);
    } else {
      await incrementalIndex(config, meta);
    }
  }
}

async function fullIndex(
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  console.log("Starting full index...");

  const commit = getCurrentCommit(config.repoRoot);
  console.log(`Commit: ${commit.slice(0, 8)}`);

  const files = await listIndexableFiles(config);
  console.log(`Found ${files.length} files`);

  let allChunks: Omit<ChunkWithVector, "vector">[] = [];
  let skipped = 0;

  for (const filePath of files) {
    try {
      const source = readFile(filePath, config.repoRoot);
      if (!source.trim()) {
        skipped++;
        continue;
      }
      const chunks = buildChunksForFile(filePath, source, commit, config);
      allChunks.push(...chunks);
    } catch {
      skipped++;
    }
  }

  console.log(
    `${allChunks.length} chunks from ${files.length - skipped} files (${skipped} skipped)`,
  );

  console.log("Embedding chunks...");
  const startTime = Date.now();
  const embedded = await embedChunks(allChunks, config, (done, total) => {
    if (done % 500 === 0 || done === total) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (done / parseFloat(elapsed)).toFixed(0);
      console.log(`  ${done}/${total} (${elapsed}s, ~${rate}/s)`);
    }
  });

  console.log(
    `Embedded ${embedded.length} chunks in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  );

  console.log("Writing to LanceDB...");
  await createTable(embedded, config);

  writeMeta(config.metaFile, {
    lastCommit: commit,
    lastIndexed: new Date().toISOString(),
    totalFiles: files.length - skipped,
    totalChunks: embedded.length,
  });

  console.log("Full index complete!");
}

async function incrementalIndex(
  config: ReturnType<typeof loadConfig>,
  meta: IndexMeta,
): Promise<void> {
  const commit = getCurrentCommit(config.repoRoot);
  console.log(
    `Last indexed: ${meta.lastCommit.slice(0, 8)} -> Current: ${commit.slice(0, 8)}`,
  );

  if (meta.lastCommit === commit) {
    console.log("Index is up to date. Nothing to do.");
    return;
  }

  const changedFiles = getChangedFilesSince(meta.lastCommit, config.repoRoot);
  const extensions = new Set(
    config.include.flatMap((g) => {
      const match = g.match(/\.(\{[^}]+\}|\w+)$/);
      if (!match) return [];
      const ext = match[1]!;
      if (ext.startsWith("{")) {
        return ext
          .slice(1, -1)
          .split(",")
          .map((e) => `.${e}`);
      }
      return [`.${ext}`];
    }),
  );

  const relevantFiles = changedFiles.filter((f) =>
    [...extensions].some((ext) => f.endsWith(ext)),
  );

  if (relevantFiles.length === 0) {
    console.log("No relevant file changes. Updating commit hash.");
    writeMeta(config.metaFile, {
      ...meta,
      lastCommit: commit,
      lastIndexed: new Date().toISOString(),
    });
    return;
  }

  console.log(`${relevantFiles.length} files changed`);

  const existing = relevantFiles.filter((f) =>
    fileExists(f, config.repoRoot),
  );
  const deleted = relevantFiles.filter(
    (f) => !fileExists(f, config.repoRoot),
  );

  if (deleted.length > 0) {
    console.log(`Removing ${deleted.length} deleted files from index`);
    await deleteByFiles(deleted, config);
  }

  let allChunks: Omit<ChunkWithVector, "vector">[] = [];
  for (const filePath of existing) {
    try {
      const source = readFile(filePath, config.repoRoot);
      if (!source.trim()) continue;
      const chunks = buildChunksForFile(filePath, source, commit, config);
      allChunks.push(...chunks);
    } catch {
      // skip
    }
  }

  console.log(`${allChunks.length} chunks to re-embed`);

  const startTime = Date.now();
  const embedded = await embedChunks(allChunks, config, (done, total) => {
    if (done % 100 === 0 || done === total) {
      console.log(`  ${done}/${total}`);
    }
  });

  console.log(
    `Embedded ${embedded.length} chunks in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
  );

  await upsertChunks(existing, embedded, config);

  writeMeta(config.metaFile, {
    lastCommit: commit,
    lastIndexed: new Date().toISOString(),
    totalFiles: meta.totalFiles,
    totalChunks: meta.totalChunks + embedded.length,
  });

  console.log("Incremental index complete!");
}

function buildChunksForFile(
  filePath: string,
  source: string,
  gitCommit: string,
  config: ReturnType<typeof loadConfig>,
): Omit<ChunkWithVector, "vector">[] {
  const rawChunks = chunkFile(filePath, source, config.maxChunkChars);
  const tags = inferTags(config.tags, filePath, source);
  const fileHash = hashContent(source);
  const indexedAt = new Date().toISOString();

  return rawChunks.map((chunk) => ({
    id: `${filePath}::${chunk.exportName}`,
    filePath,
    exportName: chunk.exportName,
    chunkType: chunk.chunkType,
    content: chunk.content,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    tags,
    fileHash,
    indexedAt,
    gitCommit,
  }));
}
