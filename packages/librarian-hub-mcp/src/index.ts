import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { validateAndEnforceRules, applyTemplateIfNew, getStructuralViolations, getDuplicateLinks, type LibrarianConfig } from "@librarian/shared";

// --- TYPES & INTERFACES ---

interface ReadFileArgs {
  path: string;
}

interface WriteFileArgs {
  path: string;
  content: string;
}

interface ValidateArgs {
  path: string;
  content: string;
}

interface TemplateArgs {
  path: string;
  content: string;
}

interface SearchArgs {
  query: string;
}

// --- CONFIGURATION & STANDARDS ---
const LATEST_HUB_VERSION = 3;

const DEFAULT_CONFIG: LibrarianConfig = {
  naming_convention: "^([A-Z][a-z0-9]+_?)+$", // Capitalized_Snake_Case
  required_yaml_fields: ["sources"],
  auto_update_date: true,
  main_branch: "master",
  hub_version: LATEST_HUB_VERSION,
  allowed_text_extensions: [".md", ".txt", ".json", ".php", ".js", ".py", ".yaml", ".yml", ".sql"]
};

function generateGitignore(config: LibrarianConfig): string {
  const extensions = config.allowed_text_extensions.map(ext => `!raw/**/*${ext}`).join("\n");
  return `
# --- LIBRARIAN CONSTITUTION: MANDATORY IGNORES ---
.librarian/

# UI & IDE Settings (Environment Agnostic)
.obsidian/
.idea/
.vscode/
.DS_Store
Thumbs.db

# Hybrid Source Management (Raw)
raw/*
${extensions}
# ------------------------------------------------
`.trim();
}

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

// --- INITIALIZATION & MIGRATION ---
function initializeHub(): void {
  // 1. Legacy Migration (v1 -> v2)
  const legacyMetaPath = path.join(KNOWLEDGE_PATH, "meta");
  const newLibrarianPath = path.join(KNOWLEDGE_PATH, ".librarian");

  if (fs.existsSync(legacyMetaPath) && !fs.existsSync(newLibrarianPath)) {
    console.error("Migrating legacy 'meta/' to '.librarian/'...");
    fs.renameSync(legacyMetaPath, newLibrarianPath);
  }

  // 2. Directory Structure
  const dirs = ["raw", "wiki", ".librarian", "wiki/Projects", "wiki/_Global", ".librarian/templates"];
  dirs.forEach(d => {
    const full = path.join(KNOWLEDGE_PATH, d);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  });

  // 3. Config Enforcement
  let currentConfig = { ...DEFAULT_CONFIG };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      currentConfig = { ...DEFAULT_CONFIG, ...saved };
    } catch (e) {
      console.error("Config corrupted, resetting to defaults.");
    }
  }
  
  // Ensure we always have the latest version in memory
  if (currentConfig.hub_version < LATEST_HUB_VERSION) {
    console.error(`Upgrading Hub from v${currentConfig.hub_version} to v${LATEST_HUB_VERSION}`);
    currentConfig.hub_version = LATEST_HUB_VERSION;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));

  // 4. Project Map Enforcement
  const projectMapFullPath = path.join(KNOWLEDGE_PATH, PROJECT_MAP_REL_PATH);
  if (!fs.existsSync(projectMapFullPath)) {
    fs.writeFileSync(projectMapFullPath, "# MAP OF PROJECTS & KNOWLEDGE NODES\n\n*Automatically managed by Librarian.*", "utf-8");
  }

  // 5. Git Constitution Enforcement
  const gitignorePath = path.join(KNOWLEDGE_PATH, ".gitignore");
  const mandatoryContent = generateGitignore(currentConfig);
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, mandatoryContent);
  } else {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".librarian/")) {
      fs.appendFileSync(gitignorePath, "\n" + mandatoryContent);
    }
  }

  // 6. Git Init
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: KNOWLEDGE_PATH });
  } catch {
    execSync("git init", { cwd: KNOWLEDGE_PATH });
    console.error("Initialized new Git repository in Hub.");
  }
}

initializeHub();

const hubConfig: LibrarianConfig = fs.existsSync(CONFIG_PATH) 
  ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) }
  : DEFAULT_CONFIG;

const mcpServer = new Server(
  { name: "librarian-hub-mcp", version: "3.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// --- MCP HANDLERS (RESOURCES) ---
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "librarian://.librarian/GEMINI.md",
        name: "Librarian Constitution",
        description: "The core rules and philosophy of the Knowledge Hub.",
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
      }
    ],
  };
});

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = new URL(request.params.uri);
  const relPath = uri.pathname.startsWith("/") ? uri.pathname.slice(1) : uri.pathname;
  const fullPath = path.join(KNOWLEDGE_PATH, relPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Resource not found: ${uri}`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: relPath.endsWith(".md") ? "text/markdown" : "application/json",
        text: fs.readFileSync(fullPath, "utf-8"),
      },
    ],
  };
});

// --- MCP HANDLERS (TOOLS) ---
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      { name: "read_file", description: "Read file from knowledge base.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "write_file_raw", description: "Directly write content to a file (use with caution).", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "grep_search", description: "Fast keyword search using grep.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "validate_content", description: "Validate content against the Librarian Constitution.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "apply_template", description: "Apply a template to the content based on file path.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "check_health", description: "Comprehensive health and structural audit of the knowledge hub.", inputSchema: { type: "object", properties: {} } },
      { name: "apply_cleanup", description: "Delete specific structural violations from the hub root. Use after careful evaluation.", inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "string" }, description: "List of filenames/directories to delete (must be structural violations)." } }, required: ["items"] } },
      { name: "update_project_map", description: "Update the global project map file.", inputSchema: { type: "object", properties: {} } },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "read_file") {
      const readArgs = args as unknown as ReadFileArgs;
      const fullPath = path.join(KNOWLEDGE_PATH, readArgs.path);
      if (!fs.existsSync(fullPath)) return { content: [{ type: "text", text: "Not found" }], isError: true };
      return { content: [{ type: "text", text: fs.readFileSync(fullPath, "utf-8") }] };
    }
    if (name === "write_file_raw") {
      const writeArgs = args as unknown as WriteFileArgs;
      const fullPath = path.join(KNOWLEDGE_PATH, writeArgs.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, writeArgs.content, "utf-8");
      return { content: [{ type: "text", text: `File written to ${writeArgs.path}` }] };
    }
    if (name === "grep_search") {
      const searchArgs = args as unknown as SearchArgs;
      const result = execSync(`grep -rEi "${searchArgs.query}" "${KNOWLEDGE_PATH}" --exclude-dir=.git --exclude-dir=.librarian || true`).toString();
      return { content: [{ type: "text", text: result || "Nothing found." }] };
    }
    if (name === "validate_content") {
      const valArgs = args as unknown as ValidateArgs;
      const val = validateAndEnforceRules(valArgs.path, valArgs.content, hubConfig);
      return { content: [{ type: "text", text: JSON.stringify(val, null, 2) }] };
    }
    if (name === "apply_template") {
      const templArgs = args as unknown as TemplateArgs;
      const content = applyTemplateIfNew(templArgs.path, templArgs.content, KNOWLEDGE_PATH);
      return { content: [{ type: "text", text: content }] };
    }
    if (name === "check_health") {
      const wikiRoot = path.join(KNOWLEDGE_PATH, "wiki");
      const wikiFiles = execSync(`find "${wikiRoot}" -name "*.md"`).toString().split("\n").filter(Boolean);
      const fileBaseNames = wikiFiles.map(f => path.basename(f, ".md"));
      const brokenLinks: string[] = [];
      const linkMap: Record<string, string[]> = {};
      
      for (const file of wikiFiles) {
        const fileContent = fs.readFileSync(file, "utf-8");
        const relPath = path.relative(KNOWLEDGE_PATH, file);
        const links = fileContent.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
        links.forEach(link => {
          const target = link.replace(/[[\]]/g, "").split("|")[0].trim();
          const targetExists = fileBaseNames.includes(target) || 
                               fs.existsSync(path.join(KNOWLEDGE_PATH, "raw", target)) || 
                               fs.existsSync(path.join(KNOWLEDGE_PATH, "raw", target + ".md")) ||
                               fs.existsSync(path.join(KNOWLEDGE_PATH, target + ".md"));
          if (!targetExists) brokenLinks.push(`${relPath}: broken link to [[${target}]]`);
          if (!linkMap[target]) linkMap[target] = [];
          linkMap[target].push(relPath);
        });
      }
      const orphans = fileBaseNames.filter(n => !linkMap[n] && n !== "PROJECT_MAP");
      const strayFiles = getStructuralViolations(KNOWLEDGE_PATH);
      const projectMapExists = fs.existsSync(path.join(KNOWLEDGE_PATH, PROJECT_MAP_REL_PATH));

      const allDuplicates: string[] = [];
      for (const file of wikiFiles) {
        const fileContent = fs.readFileSync(file, "utf-8");
        const dupes = getDuplicateLinks(fileContent);
        if (dupes.length > 0) {
          allDuplicates.push(`${path.relative(KNOWLEDGE_PATH, file)}: ${dupes.join(", ")}`);
        }
      }

      // NEW: Git Index Audit
      let gitDirty = false;
      let trackedViolations: string[] = [];
      try {
        const status = execSync("git status --short", { cwd: KNOWLEDGE_PATH }).toString();
        gitDirty = status.length > 0;
        
        // Find files that ARE tracked but SHOULD BE ignored
        const trackedFiles = execSync("git ls-files", { cwd: KNOWLEDGE_PATH }).toString().split("\n").filter(Boolean);
        trackedViolations = trackedFiles.filter(f => {
          // Block UI/IDE settings
          if (f.startsWith(".obsidian/") || f.startsWith(".idea/") || f.startsWith(".vscode/")) return true;
          // Block Librarian internals
          if (f.startsWith(".librarian/")) return true;
          // Block raw binaries, allow text
          if (f.startsWith("raw/")) {
            const ext = path.extname(f).toLowerCase();
            return !hubConfig.allowed_text_extensions.includes(ext);
          }
          return false;
        });
      } catch (e) {
        console.error("Git audit failed");
      }

      const report = [
        "--- LIBRARIAN HUB HEALTH REPORT ---",
        `Project Map Status: ${projectMapExists ? "OK" : "MISSING (CRITICAL)"}`,
        `Git Index Status: ${gitDirty ? "DIRTY (Action Required)" : "CLEAN"}`,
        `Broken links: ${brokenLinks.length}`,
        `Duplicates: ${allDuplicates.length}`,
        `Orphans: ${orphans.length}`,
        `Structural Violations: ${strayFiles.length + trackedViolations.length}`,
        "",
        brokenLinks.length > 0 ? "Broken Links:\n" + brokenLinks.join("\n") : "",
        allDuplicates.length > 0 ? "\nDuplicate Links:\n" + allDuplicates.join("\n") : "",
        orphans.length > 0 ? "\nOrphaned Nodes: " + orphans.join(", ") : "",
        (strayFiles.length > 0 || trackedViolations.length > 0) ? "\n!!! STRUCTURAL VIOLATIONS !!!" : "",
        strayFiles.length > 0 ? "\n[FS] Untracked/Illegal objects in root:\n" + strayFiles.map(f => `- ${f}`).join("\n") : "",
        trackedViolations.length > 0 ? "\n[GIT] Unauthorized tracked files (must be cached-removed):\n" + trackedViolations.slice(0, 10).map(f => `- ${f}`).join("\n") + (trackedViolations.length > 10 ? `\n... and ${trackedViolations.length - 10} more` : "") : "",
        (strayFiles.length > 0 || trackedViolations.length > 0 || gitDirty) ? "\nRECOMMENDATION: Use 'apply_cleanup' to purge illegal objects and synchronize Git index." : "Status: ARCHITECTURAL INTEGRITY VERIFIED."
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text", text: report }] };
    }
    if (name === "apply_cleanup") {
      const { items } = args as { items: string[] };
      const strayFiles = getStructuralViolations(KNOWLEDGE_PATH);
      const deleted: string[] = [];
      const gitPurged: string[] = [];
      const ignored: string[] = [];
      
      // 1. Process FS and Git-cached items
      items.forEach(item => {
        const full = path.join(KNOWLEDGE_PATH, item);
        
        // Handle explicit Git Index Purge
        const isUI = item.startsWith(".obsidian") || item.startsWith(".idea") || item.startsWith(".vscode");
        const isInternal = item.startsWith(".librarian");
        const isRawBinary = item.startsWith("raw") && !hubConfig.allowed_text_extensions.includes(path.extname(item).toLowerCase());

        if (isUI || isInternal || isRawBinary) {
           try {
             execSync(`git rm -r --cached "${item}"`, { cwd: KNOWLEDGE_PATH });
             gitPurged.push(item);
           } catch (e) {
             ignored.push(item + " (git-rm failed)");
           }
           return;
        }

        if (strayFiles.includes(item) && fs.existsSync(full)) {
          if (fs.statSync(full).isDirectory()) {
            fs.rmSync(full, { recursive: true, force: true });
          } else {
            fs.unlinkSync(full);
          }
          deleted.push(item);
        } else {
          ignored.push(item);
        }
      });

      // 2. Final Sync: stage all legitimate deletions and additions
      try {
        execSync("git add -A", { cwd: KNOWLEDGE_PATH });
      } catch (e) {
        console.error("Final git sync failed");
      }
      
      let msg = `CLEANUP RESULT:\n- FS Deleted: ${deleted.length} items.`;
      if (gitPurged.length > 0) msg += `\n- Git Index Purged: ${gitPurged.join(", ")}`;
      if (deleted.length > 0) msg += ` (${deleted.join(", ")})`;
      if (ignored.length > 0) msg += `\nWarning: ignored/failed ${ignored.length} items: ${ignored.join(", ")}`;
      msg += "\n\nNote: All changes staged. You MUST call git_commit to finalize.";
      
      return { content: [{ type: "text", text: msg }] };
    }
    if (name === "update_project_map") {
      const projectsDir = path.join(KNOWLEDGE_PATH, "wiki", "Projects");
      const globalDir = path.join(KNOWLEDGE_PATH, "wiki", "_Global");
      const projects = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir).filter(f => fs.statSync(path.join(projectsDir, f)).isDirectory()) : [];
      const globalNodes = fs.existsSync(globalDir) ? fs.readdirSync(globalDir).filter(f => !f.startsWith(".")) : [];
      
      // Deduplicate and sort
      const projectLinks = Array.from(new Set(projects)).sort().map(p => `- [[${p}]]`);
      const globalLinks = Array.from(new Set(globalNodes.map(g => g.replace(".md", "")))).sort().map(g => `- [[${g}]]`);

      const mapContent = "# MAP OF PROJECTS & KNOWLEDGE NODES\n\n## 📂 Projects\n" + projectLinks.join("\n") + "\n\n## 🌐 Global Nodes\n" + globalLinks.join("\n");
      fs.writeFileSync(path.join(KNOWLEDGE_PATH, PROJECT_MAP_REL_PATH), mapContent, "utf-8");
      return { content: [{ type: "text", text: "Map updated." }] };
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
  console.error("Librarian Hub MCP ready.");
}

run().catch(console.error);
