import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getChunksByFile } from "../storage/lancedb.js";
import { isFileModified, readLiveFile } from "../freshness/git-diff.js";
import { chunkFile } from "../parsers/chunker.js";
import { inferTags } from "../tags/tagger.js";
import type { ResolvedConfig } from "../config/loader.js";

export function registerFileContextTool(
  server: McpServer,
  config: ResolvedConfig,
) {
  server.tool(
    "get_file_context",
    "Get all indexed chunks for a specific file, showing its structure (functions, components, types). If the file is modified on the current branch, returns live content.",
    {
      file_path: z
        .string()
        .describe("Relative file path from repo root"),
    },
    { title: "Get File Context", readOnlyHint: true, destructiveHint: false },
    async ({ file_path }) => {
      try {
        if (isFileModified(file_path, config)) {
          const liveSource = readLiveFile(file_path, config);
          if (!liveSource) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `File not found: ${file_path}`,
                },
              ],
            };
          }

          const chunks = await chunkFile(
            file_path,
            liveSource,
            config.maxChunkChars,
          );
          const tags = inferTags(config.tags, file_path, liveSource);
          const tagStr = Object.entries(tags)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" | ");

          const text = [
            `## ${file_path} [LIVE — modified on branch]`,
            tagStr ? tagStr : "",
            `Chunks: ${chunks.length}`,
            "",
            ...chunks.map(
              (c) =>
                `### ${c.exportName} (${c.chunkType}) — lines ${c.startLine}-${c.endLine}\n\`\`\`\n${c.content}\n\`\`\``,
            ),
          ]
            .filter(Boolean)
            .join("\n");

          return { content: [{ type: "text" as const, text }] };
        }

        const rows = await getChunksByFile(file_path, config);

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No indexed chunks for ${file_path}. File may not be indexed yet — run reindex.`,
              },
            ],
          };
        }

        rows.sort(
          (a, b) => (a.start_line as number) - (b.start_line as number),
        );

        // Collect tag values from first row
        const tagValues: string[] = [];
        for (const tag of config.tags) {
          const val = rows[0]![tag.name];
          if (val) tagValues.push(`${tag.name}: ${val}`);
        }

        const text = [
          `## ${file_path}`,
          tagValues.length > 0 ? tagValues.join(" | ") : "",
          `Chunks: ${rows.length}`,
          "",
          ...rows.map(
            (r) =>
              `### ${r.export_name} (${r.chunk_type}) — lines ${r.start_line}-${r.end_line}\n\`\`\`\n${r.content}\n\`\`\``,
          ),
        ]
          .filter(Boolean)
          .join("\n");

        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
        };
      }
    },
  );
}
