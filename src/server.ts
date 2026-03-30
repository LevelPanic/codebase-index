#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchTool } from "./tools/search-codebase.js";
import { registerFileContextTool } from "./tools/get-file-context.js";
import { loadConfig } from "./config/loader.js";

const config = loadConfig();

const server = new McpServer({
  name: "codebase-index",
  version: "1.0.0",
});

registerSearchTool(server, config);
registerFileContextTool(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
