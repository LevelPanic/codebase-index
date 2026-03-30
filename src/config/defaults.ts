import type { CodebaseIndexConfig } from "./schema.js";

export const DEFAULT_CONFIG: CodebaseIndexConfig = {
  include: ["**/*.{ts,tsx,js,jsx}"],
  exclude: [
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
  ],
  output: ".codebase-index",
  baseBranch: "main",
  maxChunkChars: 2000,
  tags: [],
  embedding: {
    provider: "ollama",
    url: "http://localhost:11434",
    model: "nomic-embed-text",
    dimensions: 768,
    batchSize: 32,
    concurrency: 4,
  },
};
