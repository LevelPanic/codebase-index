import { z } from "zod";

const TagRuleSchema = z.object({
  pattern: z.string().optional().describe("Substring matched against file path"),
  contentPattern: z
    .string()
    .optional()
    .describe("Regex matched against file content"),
  value: z.string().describe("Tag value assigned when pattern matches"),
});

const TagDefinitionSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z_]+$/,
      "Tag names must be lowercase alphanumeric + underscore",
    ),
  description: z.string().optional(),
  defaultValue: z.string().default("other"),
  rules: z.array(TagRuleSchema).min(1),
});

const EmbeddingConfigSchema = z.object({
  provider: z.enum(["ollama"]).default("ollama"),
  url: z.string().default("http://localhost:11434"),
  model: z.string().default("nomic-embed-text"),
  dimensions: z.number().default(768),
  batchSize: z.number().default(32),
  concurrency: z.number().default(4),
});

export const ConfigSchema = z.object({
  include: z.array(z.string()).default(["**/*.{ts,tsx,js,jsx}"]),
  exclude: z
    .array(z.string())
    .default([
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/__tests__/**",
      "**/e2e/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/*.d.ts",
      "**/generated/**",
    ]),
  output: z.string().default(".codebase-index"),
  baseBranch: z.string().default("main"),
  maxChunkChars: z.number().default(2000),
  tags: z.array(TagDefinitionSchema).default([]),
  embedding: EmbeddingConfigSchema.default({}),
});

export type CodebaseIndexConfig = z.infer<typeof ConfigSchema>;
export type TagDefinition = z.infer<typeof TagDefinitionSchema>;
export type TagRule = z.infer<typeof TagRuleSchema>;
