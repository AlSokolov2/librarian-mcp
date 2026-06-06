import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { type LibrarianConfig } from "@librarian/shared";
import { HubManager } from "./core/HubManager.js";
import { initializeHub, DEFAULT_CONFIG } from "./bootstrap/initializer.js";

// --- CONFIGURATION ---
let KNOWLEDGE_PATH = process.env.KNOWLEDGE_HUB_PATH || "";
if (fs.existsSync("/app/knowledge-hub")) {
  KNOWLEDGE_PATH = "/app/knowledge-hub";
}

if (!KNOWLEDGE_PATH) {
  console.error("Error: KNOWLEDGE_HUB_PATH is not set.");
  process.exit(1);
}

const CONFIG_PATH = path.join(KNOWLEDGE_PATH, ".librarian", "config.json");
const PROJECT_MAP_REL_PATH = "wiki/PROJECT_MAP.md";

// --- INITIALIZATION ---
initializeHub(KNOWLEDGE_PATH, CONFIG_PATH, PROJECT_MAP_REL_PATH);

const hubConfig: LibrarianConfig = fs.existsSync(CONFIG_PATH)
  ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) }
  : DEFAULT_CONFIG;

const hubManager = new HubManager(KNOWLEDGE_PATH, hubConfig);

const mcpServer = new Server(
  { name: "librarian-hub-mcp", version: "5.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// --- MCP HANDLERS (RESOURCES) ---
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "librarian://.librarian/INSTRUCTIONS.md",
        name: "Librarian Core Instructions",
        description: "Mandatory structural and procedural rules for all AI agents. Read this first.",
        mimeType: "text/markdown",
      },
      {
        uri: "librarian://.librarian/config.json",
        name: "Librarian Configuration",
        description: "Active validation rules for the knowledge base.",
        mimeType: "application/json",
      },
      {
        uri: "librarian://wiki/PROJECT_MAP.md",
        name: "Project Map",
        description: "Global index of all projects and knowledge nodes.",
        mimeType: "text/markdown",
      },
    ],
  };
});

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = new URL(request.params.uri);
  const relPath = uri.pathname.startsWith("/") ? uri.pathname.slice(1) : uri.pathname;
  
  try {
    const text = hubManager.readFile(relPath);
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: relPath.endsWith(".md") ? "text/markdown" : "application/json",
          text,
        },
      ],
    };
  } catch (error) {
    throw new Error(`Resource not found: ${uri}`);
  }
});

// --- MCP HANDLERS (TOOLS) ---
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description: "The MANDATORY way to read files from the Knowledge Hub. Ensures environment-agnostic paths.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      {
        name: "write_file_raw",
        description:
          "THE ONLY PERMITTED WAY to write to the Knowledge Hub. Bypasses standard FS tools. Use ONLY within the Librarian Protocol (Branch -> Validate -> Write).",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      {
        name: "grep_search",
        description: "Fast keyword search using grep. Preferred for structural discovery.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      {
        name: "validate_content",
        description: "MANDATORY: Validate content against the Librarian Instructions before any write operation.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      {
        name: "apply_template",
        description: "Enforce structural standards by applying a template to the content based on file path.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      {
        name: "check_health",
        description:
          "CRITICAL: Run this to verify if your intended changes violate the Knowledge OS integrity before committing.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "apply_cleanup",
        description: "Administrative tool to purge structural violations. Use with extreme caution after health check.",
        inputSchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "string" },
              description: "List of filenames/directories to delete (must be structural violations).",
            },
          },
          required: ["items"],
        },
      },
      {
        name: "update_project_map",
        description: "Synchronize the global project map with current filesystem state.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "read_file": {
        const { path: relPath } = args as { path: string };
        try {
          const text = hubManager.readFile(relPath);
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return { content: [{ type: "text", text: "Not found" }], isError: true };
        }
      }
      case "write_file_raw": {
        const { path: relPath, content } = args as { path: string; content: string };
        const result = hubManager.writeFileRaw(relPath, content);
        return { content: [{ type: "text", text: result }] };
      }
      case "grep_search": {
        const { query } = args as { query: string };
        const result = hubManager.grepSearch(query);
        return { content: [{ type: "text", text: result }] };
      }
      case "validate_content": {
        const { path: relPath, content } = args as { path: string; content: string };
        const result = hubManager.validateContent(relPath, content);
        return { content: [{ type: "text", text: result }] };
      }
      case "apply_template": {
        const { path: relPath, content } = args as { path: string; content: string };
        const result = hubManager.applyTemplate(relPath, content);
        return { content: [{ type: "text", text: result }] };
      }
      case "check_health": {
        const result = hubManager.checkHealth();
        return { content: [{ type: "text", text: result }] };
      }
      case "apply_cleanup": {
        const { items } = args as { items: string[] };
        const result = hubManager.applyCleanup(items);
        return { content: [{ type: "text", text: result }] };
      }
      case "update_project_map": {
        const result = hubManager.updateProjectMap();
        return { content: [{ type: "text", text: result }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("Librarian Hub MCP ready.");
}

run().catch(console.error);
