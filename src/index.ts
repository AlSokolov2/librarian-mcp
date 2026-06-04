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
import express from "express";
import * as lancedb from "@lancedb/lancedb";
import { pipeline } from "@huggingface/transformers";
import { validateAndEnforceRules, applyTemplateIfNew, LibrarianConfig } from "./core.js";

// --- CONFIGURATION ---
const DEFAULT_CONFIG: LibrarianConfig = {
  naming_convention: "^([A-Z][a-z0-9]+_?)+$", // Capitalized_Snake_Case
  required_yaml_fields: ["sources"],
  auto_update_date: true,
  main_branch: "master",
  enable_http_api: process.env.ENABLE_INGEST_API === "true",
  api_port: parseInt(process.env.PORT || "3000"),
  api_key: process.env.LIBRARIAN_API_KEY || "librarian-secret-key"
};

let KNOWLEDGE_PATH = process.env.KNOWLEDGE_HUB_PATH || "";
if (fs.existsSync("/app/knowledge-hub")) {
  KNOWLEDGE_PATH = "/app/knowledge-hub";
}

if (!KNOWLEDGE_PATH) {
  console.error("Error: KNOWLEDGE_HUB_PATH is not set.");
  process.exit(1);
}

const MAIN_BRANCH = DEFAULT_CONFIG.main_branch;
const DB_PATH = path.join(KNOWLEDGE_PATH, "meta", "vectors");
const CONFIG_PATH = path.join(KNOWLEDGE_PATH, "meta", "config.json");

// --- INITIALIZATION ---
function initializeHub() {
  const dirs = ["raw", "wiki", "meta", "scripts", "wiki/Projects", "wiki/_Global", "meta/templates"];
  dirs.forEach(d => {
    const full = path.join(KNOWLEDGE_PATH, d);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

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

// --- AI STATE ---
let extractor: any = null;

async function getEmbedding(text: string): Promise<number[]> {
  if (!extractor) {
    console.error("Loading embedding model: Xenova/all-MiniLM-L6-v2...");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  const output = (await extractor(text, { pooling: "mean", normalize: true })) as any;
  return Array.from(output.data as number[]);
}

const mcpServer = new Server(
  { name: "knowledge-hub-librarian", version: "1.9.1" },
  { capabilities: { tools: {}, resources: {} } }
);

// --- HELPERS ---
function execHubCommand(command: string) {
  try {
    return execSync(command, { cwd: KNOWLEDGE_PATH }).toString();
  } catch (error: any) {
    return error.stdout?.toString() || error.stderr?.toString() || error.message;
  }
}

async function indexFile(relPath: string, content: string) {
  try {
    const db = await lancedb.connect(DB_PATH);
    const tableExists = (await db.tableNames()).includes("knowledge_chunks");
    const vector = await getEmbedding(content.substring(0, 10000));
    const data = [{ vector, text: content.substring(0, 5000), path: relPath }];
    if (tableExists) {
      const table = await db.openTable("knowledge_chunks");
      await table.delete(`path = "${relPath}"`);
      await table.add(data);
    } else {
      await db.createTable("knowledge_chunks", data);
    }
  } catch {
    console.error("Indexing failed.");
  }
}

// --- MCP HANDLERS (RESOURCES) ---
mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "librarian://meta/GEMINI.md",
        name: "Librarian Constitution",
        description: "The core rules and philosophy of the Knowledge Hub.",
        mimeType: "text/markdown",
      },
      {
        uri: "librarian://meta/config.json",
        name: "Librarian Configuration",
        description: "Active validation rules for the knowledge base.",
        mimeType: "application/json",
      },
      {
        uri: "librarian://meta/PROJECT_MAP.md",
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
      { name: "search_knowledge", description: "Keyword search.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "semantic_search", description: "Semantic search (Local AI).", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "read_file", description: "Read file.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      { name: "write_file", description: "Write to draft.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, draft_name: { type: "string" } }, required: ["path", "content"] } },
      { name: "list_drafts", description: "List drafts.", inputSchema: { type: "object", properties: {} } },
      { name: "approve_draft", description: "Approve draft.", inputSchema: { type: "object", properties: { draft_name: { type: "string" } }, required: ["draft_name"] } },
      { name: "discard_draft", description: "Discard draft.", inputSchema: { type: "object", properties: { draft_name: { type: "string" } }, required: ["draft_name"] } },
      { name: "reindex_all", description: "Full re-indexing.", inputSchema: { type: "object", properties: {} } },
      { name: "check_health", description: "Health audit.", inputSchema: { type: "object", properties: {} } },
      { name: "update_project_map", description: "Update project map.", inputSchema: { type: "object", properties: {} } },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "search_knowledge") {
      const result = execSync(`grep -rEi "${String(args?.query)}" "${KNOWLEDGE_PATH}" --exclude-dir=.git || true`).toString();
      return { content: [{ type: "text", text: result || "Nothing found." }] };
    }
    if (name === "semantic_search") {
      const db = await lancedb.connect(DB_PATH);
      const table = await db.openTable("knowledge_chunks");
      const results = await table.search(await getEmbedding(String(args?.query))).limit(5).toArray();
      const text = results.map(r => `[Score: ${Math.round((r._distance as number) * 100) / 100}] ${r.path}:\n${String(r.text).substring(0, 300)}...`).join("\n\n---\n\n");
      return { content: [{ type: "text", text: text || "No results." }] };
    }
    if (name === "read_file") {
      const fullPath = path.join(KNOWLEDGE_PATH, String(args?.path));
      if (!fs.existsSync(fullPath)) return { content: [{ type: "text", text: "Not found" }], isError: true };
      return { content: [{ type: "text", text: fs.readFileSync(fullPath, "utf-8") }] };
    }
    if (name === "write_file") {
      const relPath = String(args?.path);
      const draftId = args?.draft_name ? String(args.draft_name) : `synthesis-${new Date().toISOString().split('T')[0]}`;
      const branchName = `draft/${draftId}`;
      let content = applyTemplateIfNew(relPath, String(args?.content), KNOWLEDGE_PATH);
      const val = validateAndEnforceRules(relPath, content, hubConfig);
      if (!val.valid) return { content: [{ type: "text", text: val.error || "Validation failed" }], isError: true };
      content = val.content;

      execHubCommand(`git checkout -b "${branchName}" || git checkout "${branchName}"`);
      const fullFilePath = path.join(KNOWLEDGE_PATH, relPath);
      fs.mkdirSync(path.dirname(fullFilePath), { recursive: true });
      fs.writeFileSync(fullFilePath, content, "utf-8");
      await indexFile(relPath, content);
      execHubCommand(`git add "${relPath}"`);
      execHubCommand(`git commit -m "Librarian: synthesis update for ${relPath}"`);
      return { content: [{ type: "text", text: `Success: recorded in ${branchName}` }] };
    }
    if (name === "list_drafts") return { content: [{ type: "text", text: execHubCommand("git branch --list 'draft/*'").trim() || "No drafts." }] };
    if (name === "approve_draft") {
      const dId = String(args?.draft_name);
      execHubCommand(`git checkout ${MAIN_BRANCH} && git merge "draft/${dId}" --no-ff -m "Approved ${dId}" && git branch -d "draft/${dId}"`);
      return { content: [{ type: "text", text: `Merged ${dId}.` }] };
    }
    if (name === "discard_draft") {
      const dId = String(args?.draft_name);
      execHubCommand(`git checkout ${MAIN_BRANCH} && git branch -D "draft/${dId}"`);
      return { content: [{ type: "text", text: `Discarded ${dId}.` }] };
    }
    if (name === "reindex_all") {
      const db = await lancedb.connect(DB_PATH);
      const wikiRoot = path.join(KNOWLEDGE_PATH, "wiki");
      const files = execSync(`find "${wikiRoot}" -name "*.md"`).toString().split("\n").filter(Boolean);
      const chunks = [];
      for (const file of files) {
        const rel = path.relative(KNOWLEDGE_PATH, file);
        const fileContent = fs.readFileSync(file, "utf-8");
        chunks.push({ vector: await getEmbedding(fileContent), text: fileContent.substring(0, 5000), path: rel });
      }
      await db.createTable("knowledge_chunks", chunks, { mode: "overwrite" });
      return { content: [{ type: "text", text: `Re-indexed ${chunks.length} files.` }] };
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
          const targetExists = fileBaseNames.includes(target) || fs.existsSync(path.join(KNOWLEDGE_PATH, "raw", target)) || fs.existsSync(path.join(KNOWLEDGE_PATH, "raw", target + ".md"));
          if (!targetExists) brokenLinks.push(`${relPath}: broken link to [[${target}]]`);
          if (!linkMap[target]) linkMap[target] = [];
          linkMap[target].push(relPath);
        });
      }
      const orphans = fileBaseNames.filter(n => !linkMap[n] && n !== "PROJECT_MAP");
      return { content: [{ type: "text", text: `Health Report:\nBroken links: ${brokenLinks.length}\nOrphans: ${orphans.length}` }] };
    }
    if (name === "update_project_map") {
      const projectsDir = path.join(KNOWLEDGE_PATH, "wiki", "Projects");
      const globalDir = path.join(KNOWLEDGE_PATH, "wiki", "_Global");
      const projects = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir).filter(f => fs.statSync(path.join(projectsDir, f)).isDirectory()) : [];
      const globalNodes = fs.existsSync(globalDir) ? fs.readdirSync(globalDir).filter(f => !f.startsWith(".")) : [];
      const mapContent = "# MAP OF PROJECTS & KNOWLEDGE NODES\n\n## 📂 Projects\n" + projects.sort().map(p => `- [[${p}]]`).join("\n") + "\n\n## 🌐 Global Nodes\n" + globalNodes.sort().map(g => `- [[${g.replace(".md", "")}]]`).join("\n");
      fs.writeFileSync(path.join(KNOWLEDGE_PATH, "meta/PROJECT_MAP.md"), mapContent, "utf-8");
      return { content: [{ type: "text", text: "Map updated." }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// --- INGEST API ---
if (hubConfig.enable_http_api) {
  const app = express();
  app.use(express.json());
  app.post("/ingest", (req, res) => {
    if (req.headers["x-api-key"] !== hubConfig.api_key) return res.status(401).json({ error: "Unauthorized" });
    const { filename, content } = req.body;
    const rawPath = path.join("raw", filename);
    const full = path.join(KNOWLEDGE_PATH, rawPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content as string, "utf-8");
    execHubCommand(`git add "${rawPath}"`);
    execHubCommand(`git commit -m "API: ingested ${filename}"`);
    res.json({ status: "success", path: rawPath });
  });
  app.listen(hubConfig.api_port, () => console.error(`Ingest API enabled on port ${hubConfig.api_port}`));
}

async function run() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("Knowledge Hub Librarian ready.");
}

run().catch(console.error);
