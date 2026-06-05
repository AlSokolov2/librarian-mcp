# 📚 Librarian MCP: Microservice Architecture

**Librarian MCP** is an intelligent orchestration layer for your personal knowledge base, following the Unix philosophy: *each service does one thing and does it perfectly.* 

It transforms a folder of Markdown files into a dynamic, structured, and safe "digital brain" by splitting responsibilities into specialized microservices coordinated by the Model Context Protocol (MCP).

---

## 🏗️ The Microservice Ecosystem

### 🛡️ Librarian Hub (`librarian-hub-mcp`)
The **Hub** is the guardian of your files and the master of Git.
- **Goal**: Manage file I/O, enforce naming conventions, handle drafts via Git branches, and audit structural health.
- **Key Tools**: `read_file`, `write_file`, `approve_draft`, `check_health`, `update_project_map`.
- **Lightweight**: No heavy AI dependencies.

### 🧠 Librarian Search (`librarian-search-mcp`)
The **Search** service is the intellectual layer of your digital brain.
- **Goal**: Provide high-speed semantic and keyword search across your entire knowledge hub.
- **Key Tools**: `semantic_search`, `search_knowledge`, `reindex_all`.
- **Private AI**: Local vector database (LanceDB) and embeddings (Transformers.js) - 100% offline.

---

## 🚀 Quick Start

### 1. Prerequisites
- Docker & Docker Compose
- A folder for your Knowledge Hub.

### 2. Configuration
1. Clone this repository:
   ```bash
   git clone https://github.com/AlSokolov2/librarian-mcp.git
   cd librarian-mcp
   ```
2. Create your `.env` file:
   ```bash
   cp .env.example .env
   ```
3. Configure `KNOWLEDGE_HUB_PATH`, `USER_ID`, and `GROUP_ID`.

### 3. Launch Both Services
```bash
docker compose up -d
```
This will build and launch two separate containers: `librarian-hub-mcp` and `librarian-search-mcp`.

### 4. Connect to your MCP Client
Add both servers to your client configuration (e.g., `~/.gemini/settings.json`):

```json
"mcpServers": {
  "librarian-hub": {
    "command": "docker",
    "args": ["exec", "-i", "librarian-hub-mcp", "node", "packages/librarian-hub-mcp/build/index.js"]
  },
  "librarian-search": {
    "command": "docker",
    "args": ["exec", "-i", "librarian-search-mcp", "node", "packages/librarian-search-mcp/build/index.js"]
  }
}
```

---

## 🎓 Knowledge Manager Skill
This repository includes a **Gemini CLI Skill** located in `SKILLS/knowledge-manager`. Activate it to help the AI agent coordinate the two services effectively.

---

## 🛠️ Development
We use **npm workspaces** and **TypeScript Project References**.
```bash
# Install all dependencies
npm install

# Build all microservices
npm run build

# Run core tests
npm test
```

---

## ⚖️ License
MIT License. Created with ❤️ by [AlSokolov2](https://github.com/AlSokolov2).
