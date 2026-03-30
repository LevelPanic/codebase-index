import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { embed } from "../embedding/ollama.js";
import { search } from "../storage/lancedb.js";
import { isFileModified, readLiveFile } from "../freshness/git-diff.js";
import { chunkFile } from "../parsers/chunker.js";
import type { ResolvedConfig } from "../config/loader.js";

export function registerSearchTool(
  server: McpServer,
  config: ResolvedConfig,
) {
  // Build dynamic schema from configured tags
  const schemaShape: Record<string, z.ZodTypeAny> = {
    query: z
      .string()
      .describe(
        "Natural language search query (e.g. 'user authentication flow', 'database connection pool')",
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Max results to return (default 10)"),
  };

  // Add a filter parameter for each configured tag
  for (const tag of config.tags) {
    const possibleValues = [
      ...new Set([...tag.rules.map((r) => r.value), tag.defaultValue]),
    ];
    schemaShape[tag.name] = z
      .enum(possibleValues as [string, ...string[]])
      .optional()
      .describe(tag.description ?? `Filter by ${tag.name}`);
  }

  server.tool(
    "search_codebase",
    "Semantic search across the codebase. Returns relevant code chunks ranked by similarity. Use to find functions, components, types, or patterns without knowing exact file paths.",
    schemaShape,
    { title: "Search Codebase", readOnlyHint: true, destructiveHint: false },
    async (params) => {
      const { query, limit, ...tagFilters } = params as {
        query: string;
        limit: number;
        [key: string]: unknown;
      };

      try {
        const queryVector = await embed(
          `search_query: ${query}`,
          config.embedding.url,
          config.embedding.model,
        );

        // Clean undefined filters
        const activeFilters: Record<string, string> = {};
        for (const [k, v] of Object.entries(tagFilters)) {
          if (v !== undefined) activeFilters[k] = v as string;
        }

        const results = await search(queryVector, config, {
          tagFilters: activeFilters,
          limit,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No results found. The index may be empty — run `codebase-index index --full` to build it.",
              },
            ],
          };
        }

        // Enrich with freshness checks
        const enriched = await Promise.all(results.map(async (row) => {
          const filePath = row.file_path as string;
          const exportName = row.export_name as string;
          const chunkType = row.chunk_type as string;
          let content = row.content as string;
          let stale = false;

          if (isFileModified(filePath, config)) {
            stale = true;
            const liveSource = readLiveFile(filePath, config);
            if (liveSource) {
              const liveChunks = await chunkFile(
                filePath,
                liveSource,
                config.maxChunkChars,
              );
              const match = liveChunks.find(
                (c) => c.exportName === exportName,
              );
              if (match) {
                content = match.content;
              } else {
                content = `[chunk '${exportName}' no longer exists in live file]\n\n${content}`;
              }
            }
          }

          // Collect tag values for display
          const tagValues: string[] = [];
          for (const tag of config.tags) {
            const val = row[tag.name];
            if (val) tagValues.push(`${tag.name}: ${val}`);
          }

          return {
            file_path: filePath,
            export_name: exportName,
            chunk_type: chunkType,
            tags: tagValues.join(" | "),
            start_line: row.start_line,
            end_line: row.end_line,
            stale,
            content,
          };
        }));

        const text = enriched
          .map(
            (r, i) =>
              `### ${i + 1}. ${r.file_path}::${r.export_name} (${r.chunk_type})${r.stale ? " [LIVE]" : ""}${r.tags ? `\n${r.tags}` : ""}\nLines: ${r.start_line}-${r.end_line}\n\`\`\`\n${r.content}\n\`\`\``,
          )
          .join("\n\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Ollama is not running. Start it with `ollama serve` and ensure the embedding model is pulled.",
              },
            ],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Search error: ${msg}` }],
        };
      }
    },
  );
}
