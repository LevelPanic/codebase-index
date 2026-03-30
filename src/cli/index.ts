#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { indexCommand } from "./commands/index-cmd.js";
import { statsCommand } from "./commands/stats.js";
import { serveCommand } from "./commands/serve.js";

const program = new Command()
  .name("codebase-index")
  .description(
    "AST-aware codebase indexing with semantic search via MCP",
  )
  .version("1.0.0");

program
  .command("init")
  .description("Generate a starter codebase-index.config.json")
  .option("--force", "Overwrite existing config file")
  .action(initCommand);

program
  .command("index")
  .description("Index the codebase (incremental by default)")
  .option("--full", "Full reindex — drop and rebuild")
  .action(indexCommand);

program
  .command("stats")
  .description("Show index statistics")
  .action(statsCommand);

program
  .command("serve")
  .description("Start the MCP server (stdio transport)")
  .action(serveCommand);

program.parse();
