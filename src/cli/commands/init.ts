import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const CONFIG_FILENAME = "codebase-index.config.json";

function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return process.cwd();
  }
}

function detectStructure(
  repoRoot: string,
): { include: string[]; hasPrisma: boolean } {
  const include: string[] = [];
  let hasPrisma = false;

  // Check for common directory patterns
  if (fs.existsSync(path.join(repoRoot, "src"))) {
    include.push("src/**/*.{ts,tsx,js,jsx}");
  }
  if (fs.existsSync(path.join(repoRoot, "apps"))) {
    include.push("apps/**/*.{ts,tsx,js,jsx}");
  }
  if (fs.existsSync(path.join(repoRoot, "packages"))) {
    include.push("packages/**/*.{ts,tsx,js,jsx}");
  }
  if (fs.existsSync(path.join(repoRoot, "lib"))) {
    include.push("lib/**/*.{ts,tsx,js,jsx}");
  }

  // Fallback
  if (include.length === 0) {
    include.push("**/*.{ts,tsx,js,jsx}");
  }

  // Check for Prisma
  try {
    const findResult = execSync(
      "find . -name schema.prisma -maxdepth 5 -not -path '*/node_modules/*' 2>/dev/null | head -1",
      { cwd: repoRoot, encoding: "utf-8", timeout: 5000 },
    ).trim();
    if (findResult) {
      hasPrisma = true;
      const prismaDir = path.dirname(findResult).replace(/^\.\//, "");
      include.push(`${prismaDir}/schema.prisma`);
    }
  } catch {
    // ignore
  }

  return { include, hasPrisma };
}

export async function initCommand(opts: { force?: boolean }) {
  const repoRoot = getRepoRoot();
  const configPath = path.join(repoRoot, CONFIG_FILENAME);

  if (fs.existsSync(configPath) && !opts.force) {
    console.error(
      `${CONFIG_FILENAME} already exists. Use --force to overwrite.`,
    );
    process.exit(1);
  }

  const { include } = detectStructure(repoRoot);

  const config = {
    include,
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
    embedding: {
      provider: "ollama",
      url: "http://localhost:11434",
      model: "nomic-embed-text",
    },
    tags: [],
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Created ${CONFIG_FILENAME}`);

  // Add output dir to .gitignore
  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".codebase-index")) {
      fs.appendFileSync(gitignorePath, "\n# Codebase index\n.codebase-index/\n");
      console.log("Added .codebase-index/ to .gitignore");
    }
  }

  console.log("\nNext steps:");
  console.log("  1. Edit the config to add tags for your repo");
  console.log("  2. Run: codebase-index index --full");
  console.log("  3. Add to your .mcp.json:");
  console.log('     { "codebase-index": { "command": "npx", "args": ["codebase-index", "serve"] } }');
}
