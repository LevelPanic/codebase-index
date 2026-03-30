import type { RawChunk } from "./ts-chunker.js";

export function chunkPrisma(source: string, maxChunkChars: number): RawChunk[] {
  const chunks: RawChunk[] = [];
  const lines = source.split("\n");

  const blockRegex = /^(model|enum|type)\s+(\w+)\s*\{/;
  let i = 0;

  while (i < lines.length) {
    const match = lines[i]!.match(blockRegex);
    if (match) {
      const [, , name] = match;
      const startLine = i + 1;
      let braceCount = 1;
      let j = i + 1;

      while (j < lines.length && braceCount > 0) {
        for (const ch of lines[j]!) {
          if (ch === "{") braceCount++;
          if (ch === "}") braceCount--;
        }
        j++;
      }

      const content = lines.slice(i, j).join("\n");
      chunks.push({
        exportName: name!,
        chunkType: "model",
        content:
          content.length > maxChunkChars
            ? content.slice(0, maxChunkChars) + "\n// ... truncated"
            : content,
        startLine,
        endLine: j,
      });

      i = j;
    } else {
      i++;
    }
  }

  return chunks;
}
