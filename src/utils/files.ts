import fg from "fast-glob";
import fs from "fs";
import path from "path";
import type { ResolvedConfig } from "../config/loader.js";

export async function listIndexableFiles(
  config: ResolvedConfig,
): Promise<string[]> {
  const files = await fg(config.include, {
    cwd: config.repoRoot,
    ignore: config.exclude,
    absolute: false,
    dot: false,
  });
  return files.sort();
}

export function readFile(relativePath: string, repoRoot: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf-8");
}

export function fileExists(relativePath: string, repoRoot: string): boolean {
  return fs.existsSync(path.join(repoRoot, relativePath));
}
