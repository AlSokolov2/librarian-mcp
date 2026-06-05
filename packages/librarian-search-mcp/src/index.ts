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
import * as lancedb from "@lancedb/lancedb";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// --- TYPES & INTERFACES ---

interface SearchArgs {
  query: string;
}

interface EmbeddingOutput {
  data: number[] | Float32Array;
}

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

// --- AI STATE ---
let extractor: FeatureExtractionPipeline | null = null;

async function getEmbedding(text: string): Promise<number[]> {
  if (!extractor) {
    console.error("Loading embedding model: Xenova/all-MiniLM-L6-v2...");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  const output = (await extractor(text, { pooling: "mean", normalize: true })) as EmbeddingOutput;
  return Array.from(output.data);
}

const mcpServer = new Server(
  { name: "librarian-search-mcp", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

// --- MCP HANDLERS (TOOLS) ---
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      { name: "semantic_search", description: "Pure AI semantic search across knowledge base.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "reindex_all", description: "Perform full re-indexing of all wiki files for semantic search.", inputSchema: { type: "object", properties: {} } },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    if (name === "semantic_search") {
      const searchArgs = args as unknown as SearchArgs;
      const db = await lancedb.connect(DB_PATH);
      const tableExists = (await db.tableNames()).includes("knowledge_chunks");
      if (!tableExists) return { content: [{ type: "text", text: "Vector database not initialized. Run reindex_all first." }], isError: true };
      
      const table = await db.openTable("knowledge_chunks");
      const results = await table.search(await getEmbedding(searchArgs.query)).limit(5).toArray();
      const text = results.map(r => `[Score: ${Math.round((r._distance as number) * 100) / 100}] ${r.path}:\n${String(r.text).substring(0, 300)}...`).join("\n\n---\n\n");
      return { content: [{ type: "text", text: text || "No results." }] };
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
