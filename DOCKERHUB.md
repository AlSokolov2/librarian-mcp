# 📚 Librarian MCP: The Personal Knowledge OS

**Librarian MCP** is an intelligent orchestration layer for your personal knowledge base, inspired by Andrej Karpathy's [LLM Wiki vision](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). 

It transforms a simple folder of Markdown files into a dynamic, structured, and safe "digital brain" accessible to any AI agent (Claude, Cursor, Gemini) via the **Model Context Protocol (MCP)**.

---

## 🚀 Key Features
*   🛡️ **Safety-First**: AI changes are isolated in `draft/*` Git branches for your review.
*   🧠 **Offline Intelligence**: Fully local vector search using `transformers.js`. No API keys needed.
*   📏 **Enforced Rules**: Strict naming conventions and mandatory metadata validation.
*   🔌 **Ingest API**: HTTP endpoint for feeding data from external tools.
*   🐳 **Docker-ready**: Lightweight, portable, and runs with your host user ID.

---

## 🛠️ Quick Start (Docker Compose)

The easiest way to run Librarian is using Docker Compose. Create a `docker-compose.yml` file:

```yaml
services:
  librarian-mcp:
    image: alsokolov2/librarian-mcp:latest
    container_name: librarian-mcp
    user: "1000:1000" # Run 'id -u' and 'id -g' to get your IDs
    volumes:
      - /path/to/your/notes:/app/knowledge-hub
    environment:
      - KNOWLEDGE_HUB_PATH=/app/knowledge-hub
      - ENABLE_INGEST_API=true
      - LIBRARIAN_API_KEY=your-secret-key
    ports:
      - "3000:3000"
    restart: unless-stopped
```

## ⚙️ Environment Variables

| Variable | Description |
| :--- | :--- |
| `KNOWLEDGE_HUB_PATH` | Internal path to the mounted knowledge base. |
| `USER_ID` / `GROUP_ID` | Host UID/GID to prevent permission conflicts. |
| `ENABLE_INGEST_API` | Set to `true` to enable the HTTP Ingest service. |
| `LIBRARIAN_API_KEY` | Security key for the Ingest API. |

---

## 🤖 Connect to your AI Agent

Add this to your MCP client configuration (e.g., `~/.gemini/settings.json` or Claude Desktop config):

```json
"mcpServers": {
  "librarian": {
    "command": "docker",
    "args": ["exec", "-i", "librarian-mcp", "node", "build/index.js"]
  }
}
```

---

## 🔒 Security & Privacy
*   **Non-Root**: Designed to run with your host user ID to prevent file permission issues.
*   **100% Private**: AI models run locally. No data leaves your machine.
*   **Git-backed**: Every action is committed to Git, creating a permanent audit trail.

---
**GitHub Repository:** [AlSokolov2/librarian-mcp](https://github.com/AlSokolov2/librarian-mcp)
