import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { ConfigSchema, type CodebaseIndexConfig } from "./schema.js";

export interface ResolvedConfig extends CodebaseIndexConfig {
  repoRoot: string;
  indexDir: string;
  metaFile: string;
  tableName: string;
}

const CONFIG_FILENAME = "codebase-index.config.json";

function findRepoRoot(startDir: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return startDir;
  }
}

function findConfigFile(startDir: string): string | null {
  let dir = startDir;
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }

  return null;
}

let cachedConfig: ResolvedConfig | null = null;

export function loadConfig(cwd?: string): ResolvedConfig {
  if (cachedConfig) return cachedConfig;

  const startDir = cwd ?? process.cwd();
  const configPath = findConfigFile(startDir);

  let rawConfig: Record<string, unknown> = {};
  let configDir = startDir;

  if (configPath) {
    const content = fs.readFileSync(configPath, "utf-8");
    rawConfig = JSON.parse(content);
    configDir = path.dirname(configPath);
  }

  const parsed = ConfigSchema.parse(rawConfig);
  const repoRoot = findRepoRoot(configDir);
  const indexDir = path.resolve(repoRoot, parsed.output);

  cachedConfig = {
    ...parsed,
    repoRoot,
    indexDir,
    metaFile: path.join(indexDir, "meta.json"),
    tableName: "chunks",
  };

  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
