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
const LATEST_HUB_VERSION = 5;

const DEFAULT_CONFIG: LibrarianConfig = {
  naming_convention: "^([A-Z][a-z0-9]+_?)+$", // Capitalized_Snake_Case
  required_yaml_fields: ["sources"],
  auto_update_date: true,
  main_branch: "master",
  hub_version: LATEST_HUB_VERSION,
  allowed_text_extensions: [".md", ".txt", ".json", ".php", ".js", ".py", ".yaml", ".yml", ".sql"],
  migration_pending: false
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
function seedTemplates(): void {
  const templatesDir = path.join(KNOWLEDGE_PATH, ".librarian", "templates");
  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
  }

  const projectTemplate = `---
tags: [project]
sources: []
---
# Project: {{title}}

## Overview
Brief description of the project.

## Tech Stack
- Item 1

## Key Wiki Nodes
- [[Node]]

## Documentation (Raw)
- [[Source]]
`;

  const entityTemplate = `---
tags: [entity]
sources: []
---
# {{title}}

## Description
Core concept or service description.

## Implementation Details
- Detail 1

## Linked Nodes
- [[PROJECT_MAP]]
`;

  const pPath = path.join(templatesDir, "Project_Template.md");
  const ePath = path.join(templatesDir, "Entity_Template.md");

  if (!fs.existsSync(pPath)) fs.writeFileSync(pPath, projectTemplate, "utf-8");
  if (!fs.existsSync(ePath)) fs.writeFileSync(ePath, entityTemplate, "utf-8");
}

function seedInstructions(): void {
  const instructionsPath = path.join(KNOWLEDGE_PATH, ".librarian", "INSTRUCTIONS.md");
  const oldConstitutionPath = path.join(KNOWLEDGE_PATH, ".librarian", "CONSTITUTION.md");
  const geminiPath = path.join(KNOWLEDGE_PATH, "GEMINI.md");

  const coreStartMarker = "<!-- LIBRARIAN_CORE_START -->";
  const coreEndMarker = "<!-- LIBRARIAN_CORE_END -->";

  const coreInstructions = `${coreStartMarker}
# 📜 LIBRARIAN KNOWLEDGE OS: CORE INSTRUCTIONS (v1.2)

> **LAW #0: THE LIBRARIAN MONOPOLY.** 
> Any modification to files within this Hub (excluding the \`raw/\` directory) MUST be performed exclusively through Librarian MCP tools. Manual manipulation or use of generic file tools is strictly forbidden.

## 1. Two-Branch Protocol (State Machine)
- **Master**: The immutable source of truth. Stable and peer-reviewed.
- **Draft**: The ONLY active editing session. All work accumulates here via commits.
- **Consolidation**: Any other branch is illegal and will be merged into \`draft\` via Accumulative Merge.

## 2. Knowledge Architecture
- 📂 **raw/**: The "Sandbox". Open for manual ingestion and raw data dumps.
- 📂 **wiki/**: The "Sanctuary". Managed exclusively by Librarian. Requires YAML metadata and Wikilinks.
- 📂 **.librarian/**: The "Engine". System layer for rules and automation.

## 3. Maintenance & Integrity
- **HEALTH CHECK:** Always run \`check_health\` before finalizing any drafting session.
- **NON-DESTRUCTIVE MERGE:** Conflicts are resolved by preserving BOTH versions in Markdown blocks.

*Violating these rules leads to architectural degradation of the Knowledge Hub.*
${coreEndMarker}`;

  let migrationNeeded = false;
  let legacyRules = "";

  // 1. Handle legacy CONSTITUTION.md
  if (fs.existsSync(oldConstitutionPath)) {
    const legacyContent = fs.readFileSync(oldConstitutionPath, "utf-8");
    if (!legacyContent.includes("LIBRARIAN KNOWLEDGE OS: CORE INSTRUCTIONS")) {
      legacyRules = `\n\n## 🪵 Legacy Custom Rules\n\n> [!caution] ACTION REQUIRED\n> The following rules were found in your legacy Constitution. Please merge them into the core sections or Local Settings.\n\n${legacyContent}`;
      migrationNeeded = true;
      fs.renameSync(oldConstitutionPath, oldConstitutionPath + ".bak");
    }
  }

  // 2. Handle root GEMINI.md
  if (fs.existsSync(geminiPath)) {
    migrationNeeded = true;
    fs.unlinkSync(geminiPath);
  }

  // 3. Write or Update INSTRUCTIONS.md
  if (!fs.existsSync(instructionsPath)) {
    fs.writeFileSync(instructionsPath, `${coreInstructions}${legacyRules}\n\n## 🏛️ Local Hub Settings\n*No local settings defined yet.*`, "utf-8");
  } else {
    let currentContent = fs.readFileSync(instructionsPath, "utf-8");
    const hasMarkers = currentContent.includes(coreStartMarker) && currentContent.includes(coreEndMarker);

    if (hasMarkers) {
      const regex = new RegExp(`${coreStartMarker}[\\s\\S]*?${coreEndMarker}`, "g");
      currentContent = currentContent.replace(regex, coreInstructions);
      fs.writeFileSync(instructionsPath, currentContent, "utf-8");
    } else {
      // AGGRESSIVE HEALING: If markers are missing, we check if it's an old core version
      if (currentContent.includes("LIBRARIAN KNOWLEDGE OS: CORE INSTRUCTIONS")) {
        console.error("Found legacy instructions without markers. Upgrading to v1.1 with protection markers...");
        // Strip the old header/version lines and wrap the rest as Local Settings or just replace if it was purely system
        const localPart = currentContent.split(/## 2\. Knowledge Architecture|## 3\. Maintenance/)[0].includes("##") 
          ? currentContent 
          : "*Legacy content merged during migration.*";
        
        fs.writeFileSync(instructionsPath, `${coreInstructions}\n\n## 🏛️ Local Hub Settings (Migrated)\n${legacyRules}\n\n${localPart}`, "utf-8");
      } else {
        // Just prepend to unknown file
        fs.writeFileSync(instructionsPath, `${coreInstructions}\n\n${legacyRules}\n\n${currentContent}`, "utf-8");
      }
    }
  }

  // 4. Update config with migration flag
  if (migrationNeeded && fs.existsSync(CONFIG_PATH)) {
    try {
      const currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      currentConfig.hub_version = 5;
      currentConfig.migration_pending = true;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));
    } catch (e) {
      console.error("Failed to update config during migration:", e);
    }
  }
}

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
    } catch {
      console.error("Config corrupted, resetting to defaults.");
    }
  }
  
  // Ensure we always have the latest version in memory
  if (currentConfig.hub_version < LATEST_HUB_VERSION) {
    console.error(`Upgrading Hub from v${currentConfig.hub_version} to v${LATEST_HUB_VERSION}`);
    currentConfig.hub_version = LATEST_HUB_VERSION;
    if (currentConfig.hub_version === 5) {
      console.error("v5 Migration: Enabling Git Structural Audit...");
    }
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

  // 7. Seed AI Instructions & Templates
  seedInstructions();
  seedTemplates();
}

initializeHub();

const hubConfig: LibrarianConfig = fs.existsSync(CONFIG_PATH) 
  ? { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) }
  : DEFAULT_CONFIG;

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
      { name: "read_file", description: "The MANDATORY way to read files from the Knowledge Hub. Ensures environment-agnostic paths.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "write_file_raw", description: "THE ONLY PERMITTED WAY to write to the Knowledge Hub. Bypasses standard FS tools. Use ONLY within the Librarian Protocol (Branch -> Validate -> Write).", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "grep_search", description: "Fast keyword search using grep. Preferred for structural discovery.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "validate_content", description: "MANDATORY: Validate content against the Librarian Instructions before any write operation.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "apply_template", description: "Enforce structural standards by applying a template to the content based on file path.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      { name: "check_health", description: "CRITICAL: Run this to verify if your intended changes violate the Knowledge OS integrity before committing.", inputSchema: { type: "object", properties: {} } },
      { name: "apply_cleanup", description: "Administrative tool to purge structural violations. Use with extreme caution after health check.", inputSchema: { type: "object", properties: { items: { type: "array", items: { type: "string" }, description: "List of filenames/directories to delete (must be structural violations)." } }, required: ["items"] } },
      { name: "update_project_map", description: "Synchronize the global project map with current filesystem state.", inputSchema: { type: "object", properties: {} } },
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

      // SMART CURATION CLASSIFICATION
      const ghosts: string[] = [];
      const misplacedNodes: string[] = [];
      const rawSources: string[] = [];
      const technicalTrash: string[] = [];

      strayFiles.forEach(file => {
        const fullPath = path.join(KNOWLEDGE_PATH, file);
        if (!fs.existsSync(fullPath)) return;

        const baseName = path.basename(file, ".md");
        const ext = path.extname(file).toLowerCase();
        
        // 1. Check for Ghost Duplicate (exists in wiki)
        const isGhost = fileBaseNames.includes(baseName);
        if (isGhost) {
          ghosts.push(file);
          return;
        }

        // 2. Check for Misplaced Node (has YAML)
        const content = fs.readFileSync(fullPath, "utf-8");
        if (ext === ".md" && content.trim().startsWith("---")) {
          misplacedNodes.push(file);
          return;
        }

        // 3. Check for Raw Source (text-based but no YAML)
        if (hubConfig.allowed_text_extensions.includes(ext)) {
          rawSources.push(file);
          return;
        }

        // 4. Everything else is Trash
        technicalTrash.push(file);
      });

      // NEW: Git Structural Audit (Two-Branch Protocol)
      let gitDirty = false;
      let illegalBranches: string[] = [];
      let currentBranch = "master";
      try {
        const status = execSync("git status --short", { cwd: KNOWLEDGE_PATH }).toString();
        gitDirty = status.length > 0;
        currentBranch = execSync("git branch --show-current", { cwd: KNOWLEDGE_PATH }).toString().trim();
        const allBranches = execSync("git branch", { cwd: KNOWLEDGE_PATH }).toString().split("\n").map(b => b.trim().replace("* ", ""));
        illegalBranches = allBranches.filter(b => b && b !== "master" && b !== "draft" && !b.startsWith("(HEAD"));
      } catch {
        console.error("Git audit failed");
      }

      const report = [
        "--- LIBRARIAN HUB HEALTH REPORT ---",
        `Project Map Status: ${projectMapExists ? "OK" : "MISSING (CRITICAL)"}`,
        `Current Branch: ${currentBranch}`,
        `Illegal Branches Found: ${illegalBranches.length}`,
        `Git Index Status: ${gitDirty ? "DIRTY" : "CLEAN"}`,
        `Broken links: ${brokenLinks.length}`,
        `Orphans: ${orphans.length}`,
        `Stray Items in Root: ${strayFiles.length}`,
        "",
        illegalBranches.length > 0 ? "!!! ILLEGAL BRANCHES FOUND (MANDATORY CONSOLIDATION REQUIRED) !!!\n" + illegalBranches.map(b => `- ${b}`).join("\n") : "",
        ghosts.length > 0 ? "!!! GHOST DUPLICATES FOUND (RECOMMEND: DELETE) !!!\n" + ghosts.map(f => `- ${f} (Exists in wiki/)`).join("\n") : "",
        misplacedNodes.length > 0 ? "!!! MISPLACED NODES FOUND (RECOMMEND: MOVE TO WIKI) !!!\n" + misplacedNodes.map(f => `- ${f}`).join("\n") : "",
        rawSources.length > 0 ? "!!! UNPROCESSED SOURCES FOUND (RECOMMEND: MOVE TO RAW) !!!\n" + rawSources.map(f => `- ${f}`).join("\n") : "",
        technicalTrash.length > 0 ? "!!! TECHNICAL TRASH FOUND (RECOMMEND: DELETE) !!!\n" + technicalTrash.map(f => `- ${f}`).join("\n") : "",
        brokenLinks.length > 0 ? "\nBroken Links:\n" + brokenLinks.join("\n") : "",
        orphans.length > 0 ? "\nOrphaned Nodes: " + orphans.join(", ") : "",
        (illegalBranches.length > 0) ? "\nRECOMMENDATION: Use 'git_consolidate_branches' to enforce Two-Branch Protocol." : 
        (strayFiles.length > 0) ? "\nRECOMMENDATION: Use 'apply_cleanup' to resolve stray files (ghosts will be deleted, others moved)." :
        (gitDirty) ? "\nRECOMMENDATION: Commit changes to crystallize state." : "Status: ARCHITECTURAL INTEGRITY VERIFIED."
      ].filter(Boolean).join("\n");

      return { content: [{ type: "text", text: report }] };
    }
    if (name === "apply_cleanup") {
      const { items } = args as { items: string[] };
      const wikiFiles = execSync(`find "${path.join(KNOWLEDGE_PATH, "wiki")}" -name "*.md"`).toString().split("\n").filter(Boolean);
      const fileBaseNames = wikiFiles.map(f => path.basename(f, ".md"));
      
      const deleted: string[] = [];
      const moved: string[] = [];
      const gitPurged: string[] = [];
      const ignored: string[] = [];
      
      items.forEach(item => {
        const full = path.join(KNOWLEDGE_PATH, item);
        if (!fs.existsSync(full) && !item.startsWith(".")) {
          ignored.push(item + " (not found)");
          return;
        }

        // 1. Handle explicit Git Index Purge for system files
        const isUI = item.startsWith(".obsidian") || item.startsWith(".idea") || item.startsWith(".vscode");
        const isInternal = item.startsWith(".librarian");
        if (isUI || isInternal) {
           try {
             execSync(`git rm -r --cached "${item}"`, { cwd: KNOWLEDGE_PATH });
             gitPurged.push(item);
           } catch {
             ignored.push(item + " (git-rm failed)");
           }
           return;
        }

        const baseName = path.basename(item, ".md");
        const ext = path.extname(item).toLowerCase();

        // 2. Logic: Ghost -> Delete
        if (fileBaseNames.includes(baseName)) {
          fs.unlinkSync(full);
          deleted.push(item + " (Ghost)");
          return;
        }

        // 3. Logic: Node -> Move to wiki/_Global/
        const content = fs.readFileSync(full, "utf-8");
        if (ext === ".md" && content.trim().startsWith("---")) {
          const dest = path.join(KNOWLEDGE_PATH, "wiki", "_Global", item);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(full, dest);
          moved.push(`${item} -> wiki/_Global/`);
          return;
        }

        // 4. Logic: Source -> Move to raw/
        if (hubConfig.allowed_text_extensions.includes(ext)) {
          const dest = path.join(KNOWLEDGE_PATH, "raw", item);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.renameSync(full, dest);
          moved.push(`${item} -> raw/`);
          return;
        }

        // 5. Logic: Technical Trash -> Delete
        if (fs.statSync(full).isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.unlinkSync(full);
        }
        deleted.push(item + " (Trash)");
      });

      // Sync index
      try { execSync("git add -A", { cwd: KNOWLEDGE_PATH }); } catch {}
      
      let msg = `SMART CLEANUP RESULT:\n- Deleted: ${deleted.length} items.\n- Moved: ${moved.length} items.`;
      if (gitPurged.length > 0) msg += `\n- Git Purged: ${gitPurged.length} items.`;
      if (moved.length > 0) msg += `\nDetails (Moved):\n` + moved.map(m => `- ${m}`).join("\n");
      if (deleted.length > 0) msg += `\nDetails (Deleted):\n` + deleted.map(d => `- ${d}`).join("\n");
      
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
