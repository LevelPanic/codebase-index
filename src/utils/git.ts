import { execSync } from "child_process";

export function getCurrentCommit(repoRoot: string): string {
  return execSync("git rev-parse HEAD", {
    cwd: repoRoot,
    encoding: "utf-8",
  }).trim();
}

export function getChangedFilesSince(
  commit: string,
  repoRoot: string,
): string[] {
  try {
    const output = execSync(`git diff --name-only ${commit}..HEAD`, {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    return output ? output.split("\n") : [];
  } catch {
    return [];
  }
}
