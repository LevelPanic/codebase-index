import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchTool } from "../../tools/search-codebase.js";
import { registerFileContextTool } from "../../tools/get-file-context.js";
import { loadConfig } from "../../config/loader.js";
import { VERSION } from "../../version.js";

export async function serveCommand() {
  const config = loadConfig();

  const server = new McpServer({
    name: "codebase-index",
    version: VERSION,
  });

  registerSearchTool(server, config);
  registerFileContextTool(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
