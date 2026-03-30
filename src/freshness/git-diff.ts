import { execSync } from "child_process";
import fs from "fs";
import type { ResolvedConfig } from "../config/loader.js";

let cachedModifiedFiles: Set<string> | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000;

export function getModifiedFiles(config: ResolvedConfig): Set<string> {
  const now = Date.now();
  if (cachedModifiedFiles && now - cacheTime < CACHE_TTL_MS) {
    return cachedModifiedFiles;
  }

  try {
    const output = execSync(
      `git diff ${config.baseBranch}...HEAD --name-only`,
      {
        cwd: config.repoRoot,
        encoding: "utf-8",
        timeout: 5000,
      },
    ).trim();

    cachedModifiedFiles = new Set(output ? output.split("\n") : []);
  } catch {
    cachedModifiedFiles = new Set();
  }

  cacheTime = now;
  return cachedModifiedFiles;
}

export function isFileModified(
  filePath: string,
  config: ResolvedConfig,
): boolean {
  return getModifiedFiles(config).has(filePath);
}

export function readLiveFile(
  filePath: string,
  config: ResolvedConfig,
): string | null {
  const fullPath = `${config.repoRoot}/${filePath}`;
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

export function invalidateCache(): void {
  cachedModifiedFiles = null;
  cacheTime = 0;
}
