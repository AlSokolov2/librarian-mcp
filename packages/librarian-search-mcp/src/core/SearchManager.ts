import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as lancedb from "@lancedb/lancedb";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

interface EmbeddingOutput {
  data: number[] | Float32Array;
}

export class SearchManager {
  private extractor: FeatureExtractionPipeline | null = null;
  private knowledgePath: string;
  private dbPath: string;

  constructor(knowledgePath: string, dbPath: string) {
    this.knowledgePath = knowledgePath;
    this.dbPath = dbPath;
  }

  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.extractor) {
      console.error("Loading embedding model: Xenova/all-MiniLM-L6-v2...");
      this.extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    const output = (await this.extractor(text, { pooling: "mean", normalize: true })) as unknown as EmbeddingOutput;
    return Array.from(output.data);
  }

  async semanticSearch(query: string): Promise<string> {
    const db = await lancedb.connect(this.dbPath);
    const tableNames = await db.tableNames();
    const tableExists = tableNames.includes("knowledge_chunks");
    
    if (!tableExists) {
      throw new Error("Vector database not initialized. Run reindex_all first.");
    }

    const table = await db.openTable("knowledge_chunks");
    const queryVector = await this.getEmbedding(query);
    const results = await table.search(queryVector).limit(5).toArray();
    
    if (results.length === 0) {
      return "No results.";
    }

    return results
      .map(r => `[Score: ${Math.round((r._distance as number) * 100) / 100}] ${r.path}:\n${String(r.text).substring(0, 300)}...`)
      .join("\n\n---\n\n");
  }

  async reindexAll(): Promise<string> {
    const db = await lancedb.connect(this.dbPath);
    const wikiRoot = path.join(this.knowledgePath, "wiki");
    
    if (!fs.existsSync(wikiRoot)) {
      throw new Error(`Wiki root not found at ${wikiRoot}`);
    }

    const files = execSync(`find "${wikiRoot}" -name "*.md"`)
      .toString()
      .split("\n")
      .filter(Boolean);
    
    const chunks = [];
    for (const file of files) {
      const rel = path.relative(this.knowledgePath, file);
      const fileContent = fs.readFileSync(file, "utf-8");
      const vector = await this.getEmbedding(fileContent);
      chunks.push({ 
        vector, 
        text: fileContent.substring(0, 5000), 
        path: rel 
      });
    }

    await db.createTable("knowledge_chunks", chunks, { mode: "overwrite" });
    return `Re-indexed ${chunks.length} files.`;
  }
}
