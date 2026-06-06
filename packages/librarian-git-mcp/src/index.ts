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
  { name: "librarian-git-mcp", version: "5.0.0" },
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

function resolveConflictsMarkdown(conflictPath: string, sourceBranch: string): void {
  const fullPath = path.join(KNOWLEDGE_PATH, conflictPath);
  if (!fs.existsSync(fullPath)) return;

  const content = fs.readFileSync(fullPath, "utf-8");
  // Regex to match standard git conflict markers
  const conflictRegex = /<<<<<<< HEAD([\s\S]*?)=======([\s\S]*?)>>>>>>> .*/g;

  const resolvedContent = content.replace(conflictRegex, (match, versionA, versionB) => {
    return `<!-- LIBRARIAN_CONFLICT_START -->
> [!CAUTION] CONFLICT: Draft vs ${sourceBranch}
> **Version A (Current Draft):**
${versionA.trim().split("\n").map((line: string) => `> ${line}`).join("\n")}
>
> ---
> **Version B (Incoming ${sourceBranch}):**
${versionB.trim().split("\n").map((line: string) => `> ${line}`).join("\n")}
<!-- LIBRARIAN_CONFLICT_END -->`;
  });

  fs.writeFileSync(fullPath, resolvedContent, "utf-8");
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
        inputSchema: { type: "object", properties: { message: { type: "string" }, files: { type: "array", items: { type: "string" }, description: "List of files to stage (dot for all)" } }, required: ["message", "files"] } 
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
    if (name === "git_branch_list") {
      const { pattern } = args as Record<string, string | undefined>;
      const cmd = pattern ? `git branch --list '${pattern}'` : "git branch";
      return { content: [{ type: "text", text: execHubCommand(cmd).trim() || "No branches found." }] };
    }
    if (name === "git_show_current_branch") {
      const branch = execHubCommand("git branch --show-current").trim();
      return { content: [{ type: "text", text: branch }] };
    }
    if (name === "git_ensure_draft") {
      const branches = execHubCommand("git branch").split("\n").map(b => b.trim().replace("* ", ""));
      if (branches.includes("draft")) {
        execHubCommand("git checkout draft");
        return { content: [{ type: "text", text: "Switched to existing 'draft' branch." }] };
      }
      execHubCommand("git checkout -b draft master");
      return { content: [{ type: "text", text: "Created and switched to new 'draft' branch from master." }] };
    }
    if (name === "git_consolidate_branches") {
      const branches = execHubCommand("git branch").split("\n").map(b => b.trim().replace("* ", "")).filter(b => b && b !== "master" && b !== "draft" && !b.startsWith("(HEAD"));
      if (branches.length === 0) return { content: [{ type: "text", text: "No branches to consolidate." }] };

      // Ensure we are on draft branch
      const currentBranches = execHubCommand("git branch").split("\n").map(b => b.trim().replace("* ", ""));
      if (!currentBranches.includes("draft")) {
        execHubCommand("git checkout -b draft master");
      } else {
        execHubCommand("git checkout draft");
      }
      
      let report = "CONSOLIDATION REPORT:\n";
      for (const branch of branches) {
        try {
          execHubCommand(`git merge ${branch} --no-ff -m "Merge legacy branch '${branch}' (Clean)"`);
          report += `- Merged '${branch}' cleanly.\n`;
        } catch (e: any) {
          // Handle conflicts
          const status = execHubCommand("git status --porcelain");
          const unmerged = status.split("\n").filter(line => line.startsWith("UU ")).map(line => line.slice(3));
          
          for (const file of unmerged) {
            resolveConflictsMarkdown(file, branch);
            execHubCommand(`git add "${file}"`);
          }
          execHubCommand(`git commit -m "Merge branch '${branch}' with accumulative conflict resolution"`);
          report += `- Merged '${branch}' with ${unmerged.length} conflicts preserved in Markdown.\n`;
        }
        execHubCommand(`git branch -D ${branch}`);
      }
      return { content: [{ type: "text", text: report }] };
    }
    if (name === "git_commit") {
      const { message, files } = args as Record<string, unknown>;
      const filesToStage = Array.isArray(files) ? files.join(" ") : String(files);
      execHubCommand(`git add ${filesToStage}`);
      execHubCommand(`git commit -m "${message}"`);
      return { content: [{ type: "text", text: `Committed changes with message: ${message}` }] };
    }
    if (name === "git_finalize_draft") {
      const { message } = args as Record<string, string>;
      execHubCommand("git checkout master");
      execHubCommand(`git merge draft --no-ff -m "${message}"`);
      execHubCommand("git branch -D draft");
      return { content: [{ type: "text", text: "Draft merged into master and deleted. Knowledge base is now in CRYSTALLIZED state." }] };
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

