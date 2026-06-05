import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// --- CONFIGURATION ---
let KNOWLEDGE_PATH = process.env.KNOWLEDGE_HUB_PATH || "";
if (fs.existsSync("/app/knowledge-hub")) {
  KNOWLEDGE_PATH = "/app/knowledge-hub";
}

if (!KNOWLEDGE_PATH) {
  console.error("Error: KNOWLEDGE_HUB_PATH is not set.");
  process.exit(1);
}

const mcpServer = new Server(
  { name: "librarian-git-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

interface GitError extends Error {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

// --- HELPERS ---
function execHubCommand(command: string): string {
  try {
    return execSync(command, { cwd: KNOWLEDGE_PATH }).toString();
  } catch (error: unknown) {
    const gitError = error as GitError;
    return String(gitError.stdout || gitError.stderr || gitError.message);
  }
}

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
        name: "git_branch_create", 
        description: "Create a new git branch.", 
        inputSchema: { type: "object", properties: { name: { type: "string" }, from: { type: "string", description: "Source branch (defaults to master)" } }, required: ["name"] } 
      },
      { 
        name: "git_branch_delete", 
        description: "Delete a git branch.", 
        inputSchema: { type: "object", properties: { name: { type: "string" }, force: { type: "boolean" } }, required: ["name"] } 
      },
      { 
        name: "git_checkout", 
        description: "Switch to a git branch.", 
        inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } 
      },
      { 
        name: "git_commit", 
        description: "Stage files and create a commit.", 
        inputSchema: { type: "object", properties: { message: { type: "string" }, files: { type: "array", items: { type: "string" }, description: "List of files to stage (dot for all)" } }, required: ["message", "files"] } 
      },
      { 
        name: "git_merge", 
        description: "Merge a branch into the current one.", 
        inputSchema: { type: "object", properties: { from: { type: "string" }, message: { type: "string" }, no_ff: { type: "boolean", default: true } }, required: ["from"] } 
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
    if (name === "git_branch_list") {
      const { pattern } = args as any;
      const cmd = pattern ? `git branch --list '${pattern}'` : "git branch";
      return { content: [{ type: "text", text: execHubCommand(cmd).trim() || "No branches found." }] };
    }
    if (name === "git_branch_create") {
      const { name: bName, from = "master" } = args as any;
      execHubCommand(`git checkout -b "${bName}" "${from}"`);
      return { content: [{ type: "text", text: `Branch '${bName}' created from '${from}'.` }] };
    }
    if (name === "git_branch_delete") {
      const { name: bName, force = false } = args as any;
      const flag = force ? "-D" : "-d";
      execHubCommand(`git branch ${flag} "${bName}"`);
      return { content: [{ type: "text", text: `Branch '${bName}' deleted.` }] };
    }
    if (name === "git_checkout") {
      const { name: bName } = args as any;
      execHubCommand(`git checkout "${bName}"`);
      return { content: [{ type: "text", text: `Switched to branch '${bName}'.` }] };
    }
    if (name === "git_commit") {
      const { message, files } = args as any;
      const filesToStage = files.join(" ");
      execHubCommand(`git add ${filesToStage}`);
      execHubCommand(`git commit -m "${message}"`);
      return { content: [{ type: "text", text: `Committed changes with message: ${message}` }] };
    }
    if (name === "git_merge") {
      const { from, message, no_ff = true } = args as any;
      const ffFlag = no_ff ? "--no-ff" : "";
      const msgFlag = message ? `-m "${message}"` : "";
      execHubCommand(`git merge ${from} ${ffFlag} ${msgFlag}`);
      return { content: [{ type: "text", text: `Merged '${from}' into current branch.` }] };
    }
    if (name === "git_status") {
      return { content: [{ type: "text", text: execHubCommand("git status") }] };
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
  console.error("Librarian Git MCP ready.");
}

run().catch(console.error);
