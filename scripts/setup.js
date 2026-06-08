import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function setup() {
  console.log("\n📚 Librarian MCP: Smart Setup Utility\n");

  const mode = await question("Select execution mode (1: Docker [recommended], 2: Local Node.js): ");
  const isDocker = mode === '1';

  let hubPath = "";
  if (fs.existsSync(path.join(projectRoot, '.env'))) {
    const envContent = fs.readFileSync(path.join(projectRoot, '.env'), 'utf-8');
    const match = envContent.match(/KNOWLEDGE_HUB_PATH=(.+)/);
    if (match) hubPath = match[1].trim();
  }

  if (!hubPath) {
    hubPath = await question("Enter absolute path to your Knowledge Hub: ");
  }

  console.log(`\nDetected Hub Path: ${hubPath}`);
  console.log(`Project Root: ${projectRoot}\n`);

  const config = {
    mcpServers: {
      "librarian-hub": {
        command: isDocker ? "docker" : "node",
        args: isDocker 
          ? ["exec", "-i", "librarian-hub-mcp", "node", "packages/librarian-hub-mcp/build/index.js"]
          : [path.join(projectRoot, "packages/librarian-hub-mcp/build/index.js")],
        env: isDocker ? {} : { "KNOWLEDGE_HUB_PATH": hubPath }
      },
      "librarian-git": {
        command: isDocker ? "docker" : "node",
        args: isDocker 
          ? ["exec", "-i", "librarian-git-mcp", "node", "packages/librarian-git-mcp/build/index.js"]
          : [path.join(projectRoot, "packages/librarian-git-mcp/build/index.js")],
        env: isDocker ? {} : { "KNOWLEDGE_HUB_PATH": hubPath }
      },
      "librarian-search": {
        command: isDocker ? "docker" : "node",
        args: isDocker 
          ? ["exec", "-i", "librarian-search-mcp", "node", "packages/librarian-search-mcp/build/index.js"]
          : [path.join(projectRoot, "packages/librarian-search-mcp/build/index.js")],
        env: isDocker ? {} : { "KNOWLEDGE_HUB_PATH": hubPath }
      }
    }
  };

  console.log("--- COPY AND PASTE THIS INTO YOUR settings.json ---");
  console.log(JSON.stringify(config.mcpServers, null, 2));
  console.log("---------------------------------------------------\n");

  const settingsPath = path.join(hubPath, '.gemini', 'settings.json');
  const save = await question(`Would you like to save this to your Knowledge Hub's local settings (${settingsPath})? (y/n): `);
  if (save.toLowerCase() === 'y') {
    try {
      let currentSettings = {};
      if (fs.existsSync(settingsPath)) {
        currentSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
      
      currentSettings.mcpServers = { ...currentSettings.mcpServers, ...config.mcpServers };
      
      if (!fs.existsSync(path.dirname(settingsPath))) {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));
      console.log(`✅ Successfully updated ${settingsPath}`);
    } catch (e) {
      console.error(`❌ Error saving settings: ${e.message}`);
    }
  }

  console.log("\nSetup complete! Don't forget to run 'npm run build' if using Local mode.");
  rl.close();
}

setup();
