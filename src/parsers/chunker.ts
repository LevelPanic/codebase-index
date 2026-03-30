import { chunkTypeScript, type RawChunk } from "./ts-chunker.js";
import { chunkPrisma } from "./prisma-chunker.js";

export type { RawChunk };

export function chunkFile(
  filePath: string,
  source: string,
  maxChunkChars: number,
): RawChunk[] {
  if (filePath.endsWith(".prisma")) {
    return chunkPrisma(source, maxChunkChars);
  }

  const isTsx = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");

  try {
    return chunkTypeScript(source, isTsx, maxChunkChars);
  } catch {
    return [
      {
        exportName: "file_summary",
        chunkType: "summary",
        content: source.slice(0, maxChunkChars),
        startLine: 1,
        endLine: source.split("\n").length,
      },
    ];
  }
}
