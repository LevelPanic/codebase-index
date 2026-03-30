import pLimit from "p-limit";
import { embed } from "./ollama.js";
import type { ResolvedConfig } from "../config/loader.js";

export interface ChunkWithVector {
  id: string;
  filePath: string;
  exportName: string;
  chunkType: string;
  content: string;
  startLine: number;
  endLine: number;
  tags: Record<string, string>;
  fileHash: string;
  indexedAt: string;
  gitCommit: string;
  vector: number[];
}

function formatForEmbedding(
  chunk: Omit<ChunkWithVector, "vector">,
): string {
  const tagStr = Object.entries(chunk.tags)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
  const tagSuffix = tagStr ? ` (${tagStr})` : "";
  return `search_document: ${chunk.chunkType} ${chunk.exportName} in ${chunk.filePath}${tagSuffix}\n${chunk.content}`;
}

export async function embedChunks(
  chunks: Omit<ChunkWithVector, "vector">[],
  config: ResolvedConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<ChunkWithVector[]> {
  const limit = pLimit(config.embedding.concurrency);
  const results: ChunkWithVector[] = [];
  let done = 0;

  const promises = chunks.map((chunk) =>
    limit(async () => {
      const text = formatForEmbedding(chunk);
      const vector = await embed(
        text,
        config.embedding.url,
        config.embedding.model,
      );
      done++;
      onProgress?.(done, chunks.length);
      return { ...chunk, vector };
    }),
  );

  const settled = await Promise.allSettled(promises);
  let failed = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      results.push(result.value);
    } else {
      failed++;
    }
  }
  if (failed > 0) {
    console.warn(`Warning: ${failed} chunks failed to embed`);
  }

  return results;
}
