import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import { GitManager } from "./core/GitManager.js";

// --- CONFIGURATION ---
let KNOWLEDGE_PATH = process.env.KNOWLEDGE_HUB_PATH || "";
if (fs.existsSync("/app/knowledge-hub")) {
  KNOWLEDGE_PATH = "/app/knowledge-hub";
}

if (!KNOWLEDGE_PATH) {
  console.error("Error: KNOWLEDGE_HUB_PATH is not set.");
  process.exit(1);
}

const gitManager = new GitManager(KNOWLEDGE_PATH);

const mcpServer = new Server(
  { name: "librarian-git-mcp", version: "5.0.0" },
  { capabilities: { tools: {} } }
);

// --- MCP HANDLERS (TOOLS) ---
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      { 
        name: "git_branch_list", 
        description: "List git branches in the knowledge hub.", 
        inputSchema: { type: "object", properties: { pattern: { type: "string", description: "Optional pattern (e.g., 'draft/*')" } } } 
      },
      { 
        name: "git_show_current_branch", 
        description: "Returns the name of the current active branch.", 
        inputSchema: { type: "object", properties: {} } 
      },
      { 
        name: "git_ensure_draft", 
        description: "MANDATORY: Ensures the 'draft' branch exists and is active. All editing must happen here.", 
        inputSchema: { type: "object", properties: {} } 
      },
      { 
        name: "git_consolidate_branches", 
        description: "CRITICAL: Merges all non-master branches into 'draft' using Accumulative Merge (preserving conflicts in Markdown).", 
        inputSchema: { type: "object", properties: {} } 
      },
      { 
        name: "git_commit", 
        description: "Stage files and create a commit in the current draft.", 
        inputSchema: { 
          type: "object", 
          properties: { 
            message: { type: "string" }, 
            files: { type: "array", items: { type: "string" }, description: "List of files to stage (dot for all)" } 
          }, 
          required: ["message", "files"] 
        } 
      },
      { 
        name: "git_finalize_draft", 
        description: "Merges 'draft' into 'master' and DELETES the draft branch. Finalizes the editing session.", 
        inputSchema: { type: "object", properties: { message: { type: "string", description: "Commit message for the merge." } }, required: ["message"] } 
      },
      { 
        name: "git_status", 
        description: "Get current git status.", 
        inputSchema: { type: "object", properties: {} } 
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case "git_branch_list": {
        const { pattern } = args as { pattern?: string };
        return { content: [{ type: "text", text: gitManager.getBranchList(pattern) }] };
      }
      case "git_show_current_branch": {
        return { content: [{ type: "text", text: gitManager.showCurrentBranch() }] };
      }
      case "git_ensure_draft": {
        return { content: [{ type: "text", text: gitManager.ensureDraft() }] };
      }
      case "git_consolidate_branches": {
        return { content: [{ type: "text", text: gitManager.consolidateBranches() }] };
      }
      case "git_commit": {
        const { message, files } = args as { message: string; files: string[] | string };
        return { content: [{ type: "text", text: gitManager.commit(message, files) }] };
      }
      case "git_finalize_draft": {
        const { message } = args as { message: string };
        return { content: [{ type: "text", text: gitManager.finalizeDraft(message) }] };
      }
      case "git_status": {
        return { content: [{ type: "text", text: gitManager.getStatus() }] };
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
  console.error("Librarian Git MCP ready.");
}

run().catch(console.error);
