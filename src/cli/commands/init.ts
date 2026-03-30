import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

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

function getServePath(): string {
  // Resolve the path to this package's CLI entry point
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, "../../cli/index.ts");
}

function detectStructure(
  repoRoot: string,
): { include: string[]; hasPrisma: boolean } {
  const include: string[] = [];
  let hasPrisma = false;

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

  if (include.length === 0) {
    include.push("**/*.{ts,tsx,js,jsx}");
  }

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
      fs.appendFileSync(
        gitignorePath,
        "\n# Codebase index\n.codebase-index/\n",
      );
      console.log("Added .codebase-index/ to .gitignore");
    }
  }

  // Wire up .mcp.json
  const servePath = getServePath();
  const mcpPath = path.join(repoRoot, ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};

  if (fs.existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    } catch {
      // invalid JSON, start fresh
    }
  }

  const servers = (mcpConfig.mcpServers as Record<string, unknown>) ?? {};
  servers["codebase-index"] = {
    command: "npx",
    args: ["tsx", servePath, "serve"],
    env: {
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    },
  };
  mcpConfig.mcpServers = servers;

  fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
  console.log("Added codebase-index to .mcp.json");

  console.log("\nNext steps:");
  console.log("  1. (Optional) Edit the config to add tags for your repo");
  console.log(
    "  2. Run: npx tsx " + servePath.replace(/ /g, "\\ ") + " index --full",
  );
  console.log("  3. Restart Claude Code to pick up the MCP server");
}
