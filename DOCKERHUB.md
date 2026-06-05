# 📚 Librarian MCP: The Atomic Knowledge OS

**Librarian MCP** is an intelligent orchestration layer for your personal knowledge base, inspired by Andrej Karpathy's [LLM Wiki vision](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). 

It transforms a folder of Markdown files into a dynamic, structured, and safe "digital brain" by splitting responsibilities into specialized microservices coordinated by the Model Context Protocol (MCP).

---

## 🏗️ The Microservice Suite

### 🛡️ Librarian Hub (`alsokolov2/librarian-hub-mcp`)
The **Hub** is the guardian of your files and the master of structure.
- **FS Health**: Enforces naming conventions and audits structural integrity.
- **Git Awareness**: Automatically manages `.gitignore` and tracks text sources.
- **Smart Templating**: Injects metadata and structure into new notes.

### 📜 Librarian Git (`alsokolov2/librarian-git-mcp`)
The **Git** service is the master of versioning.
- **Safety**: Isolates changes in `draft/*` branches.
- **Primitives**: Provides atomic Git operations for AI agents.

### 🧠 Librarian Search (`alsokolov2/librarian-search-mcp`)
The **Search** service is the intellectual layer.
- **Semantic Search**: Fully local AI (Transformers.js + LanceDB).
- **Keyword Search**: Blazing fast regex-based lookup.

---

## 🚀 Quick Start (Docker Compose)

The easiest way to run the suite is using Docker Compose:

```yaml
services:
  librarian-hub:
    image: alsokolov2/librarian-hub-mcp:latest
    container_name: librarian-hub-mcp
    user: "1000:1000" # Run 'id -u' and 'id -g'
    volumes:
      - /path/to/your/notes:/app/knowledge-hub
    environment:
      - KNOWLEDGE_HUB_PATH=/app/knowledge-hub
    stdin_open: true
    tty: true
    restart: unless-stopped

  librarian-git:
    image: alsokolov2/librarian-git-mcp:latest
    container_name: librarian-git-mcp
    user: "1000:1000"
    volumes:
      - /path/to/your/notes:/app/knowledge-hub
    environment:
      - KNOWLEDGE_HUB_PATH=/app/knowledge-hub
    stdin_open: true
    tty: true
    restart: unless-stopped

  librarian-search:
    image: alsokolov2/librarian-search-mcp:latest
    container_name: librarian-search-mcp
    user: "1000:1000"
    volumes:
      - /path/to/your/notes:/app/knowledge-hub
    environment:
      - KNOWLEDGE_HUB_PATH=/app/knowledge-hub
    stdin_open: true
    tty: true
    restart: unless-stopped
```

---

## 🔒 Hybrid Git Standard
Librarian implements a **"Text-Heavy, Binary-Light"** standard:
*   **Tracked**: `.md`, `.txt`, `.json`, `.php`, `.js`, `.py`, `.yaml`, etc.
*   **Ignored**: `.pdf`, `.png`, `.jpg`, `.zip` and UI settings (`.obsidian/`).

---
**GitHub Repository:** [AlSokolov2/librarian-mcp](https://github.com/AlSokolov2/librarian-mcp)
