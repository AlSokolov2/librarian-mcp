import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { SearchManager } from "./core/SearchManager.js";

// --- CONFIGURATION ---
let KNOWLEDGE_PATH = process.env.KNOWLEDGE_HUB_PATH || "";
if (fs.existsSync("/app/knowledge-hub")) {
  KNOWLEDGE_PATH = "/app/knowledge-hub";
}

if (!KNOWLEDGE_PATH) {
  console.error("Error: KNOWLEDGE_HUB_PATH is not set.");
  process.exit(1);
}

const DB_PATH = path.join(KNOWLEDGE_PATH, ".librarian", "vectors");

// --- INITIALIZATION ---
const searchManager = new SearchManager(KNOWLEDGE_PATH, DB_PATH);

const mcpServer = new Server(
  { name: "librarian-search-mcp", version: "5.0.0" },
  { capabilities: { tools: {} } }
);

// --- MCP HANDLERS (TOOLS) ---
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      { 
        name: "semantic_search", 
        description: "Pure AI semantic search across knowledge base.", 
        inputSchema: { 
          type: "object", 
          properties: { query: { type: "string" } }, 
          required: ["query"] 
        } 
      },
      { 
        name: "reindex_all", 
        description: "Perform full re-indexing of all wiki files for semantic search.", 
        inputSchema: { type: "object", properties: {} } 
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "semantic_search") {
      const { query } = args as { query: string };
      const result = await searchManager.semanticSearch(query);
      return { content: [{ type: "text", text: result }] };
    }
    if (name === "reindex_all") {
      const result = await searchManager.reindexAll();
      return { content: [{ type: "text", text: result }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("Librarian Search MCP ready.");
}

run().catch(console.error);
