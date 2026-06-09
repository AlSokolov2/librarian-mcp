import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { type LibrarianConfig } from "@librarian/shared";

export const LATEST_HUB_VERSION = 6;

export const DEFAULT_CONFIG: LibrarianConfig = {
  naming_convention: "^([A-Z][a-z0-9]+_?)+$", // Capitalized_Snake_Case
  required_yaml_fields: ["sources"],
  auto_update_date: true,
  main_branch: "master",
  hub_version: LATEST_HUB_VERSION,
  allowed_text_extensions: [".md", ".txt", ".json", ".php", ".js", ".py", ".yaml", ".yml", ".sql"],
  language: "en",
  migration_pending: false,
};

function migrateV5toV6_Indices(knowledgePath: string) {
  console.error("Starting V5 -> V6 Migration: Renaming legacy README.md to index.md and repairing links in wiki/...");
  const wikiPath = path.join(knowledgePath, "wiki");
  if (!fs.existsSync(wikiPath)) return;

  const markdownFiles: string[] = [];

  function walkAndRename(dir: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory() && !item.startsWith(".")) {
        walkAndRename(fullPath);
      } else if (item.toLowerCase() === "readme.md") {
        // Skip root README
        if (dir === knowledgePath) continue; 

        const newPath = path.join(dir, "index.md");
        if (fs.existsSync(newPath)) {
          console.error(`Conflict found: ${newPath} already exists. Renaming old README to README.md.bak`);
          fs.renameSync(fullPath, fullPath + ".bak");
        } else {
          console.error(`Migrating: ${fullPath} -> index.md`);
          fs.renameSync(fullPath, newPath);
          markdownFiles.push(newPath); // It's a markdown file we should check for links
        }
      } else if (item.endsWith(".md")) {
        markdownFiles.push(fullPath);
      }
    }
  }

  walkAndRename(wikiPath);

  // Auto-heal links
  let modifiedCount = 0;
  for (const file of markdownFiles) {
    const content = fs.readFileSync(file, "utf-8");
    if (content.match(/\[\[.*?README.*?\]\]/i)) {
      let newContent = content.replace(/\[\[(.*?\/)README(\|.*?)?\]\]/g, "[[$1index$2]]");
      newContent = newContent.replace(/\[\[(.*?\/)README\.md(\|.*?)?\]\]/g, "[[$1index$2]]");
      if (newContent !== content) {
        fs.writeFileSync(file, newContent, "utf-8");
        modifiedCount++;
      }
    }
  }
  console.error(`V5 -> V6 Migration completed. Auto-healed ${modifiedCount} files with legacy links.`);
}

function generateGitignore(config: LibrarianConfig): string {
  const extensions = config.allowed_text_extensions.map((ext) => `!raw/**/*${ext}`).join("\n");
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

export function seedTemplates(knowledgePath: string): void {
  const templatesDir = path.join(knowledgePath, ".librarian", "templates");
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

export function seedInstructions(knowledgePath: string, configPath: string): void {
  const instructionsPath = path.join(knowledgePath, ".librarian", "INSTRUCTIONS.md");
  const oldConstitutionPath = path.join(knowledgePath, ".librarian", "CONSTITUTION.md");
  const geminiPath = path.join(knowledgePath, "GEMINI.md");

  const coreStartMarker = "<!-- LIBRARIAN_CORE_START -->";
  const coreEndMarker = "<!-- LIBRARIAN_CORE_END -->";

  const coreInstructions = `${coreStartMarker}
# 📜 LIBRARIAN KNOWLEDGE OS: CORE INSTRUCTIONS (v1.3)

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

## 4. Border Control Protocol (Cross-Hub Security)
- Before executing any file write or modifying shell command OUTSIDE the primary Hub directory, you MUST read the target directory's \`.librarian/config.json\`. 
- If the \`hub_id\` found there differs from the one returned by your \`get_hub_info\` tool, you are in a foreign jurisdiction.
- You MUST refuse any write operations and inform the user that you only have Read-Only access to external hubs.

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
    fs.writeFileSync(
      instructionsPath,
      `${coreInstructions}${legacyRules}\n\n## 🏛️ Local Hub Settings\n*No local settings defined yet.*`,
      "utf-8"
    );
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
        const localPart = currentContent.split(/## 2\. Knowledge Architecture|## 3\. Maintenance/)[0].includes("##")
          ? currentContent
          : "*Legacy content merged during migration.*";

        fs.writeFileSync(
          instructionsPath,
          `${coreInstructions}\n\n## 🏛️ Local Hub Settings (Migrated)\n${legacyRules}\n\n${localPart}`,
          "utf-8"
        );
      } else {
        // Just prepend to unknown file
        fs.writeFileSync(instructionsPath, `${coreInstructions}\n\n${legacyRules}\n\n${currentContent}`, "utf-8");
      }
    }
  }

  // 4. Update config with migration flag
  if (migrationNeeded && fs.existsSync(configPath)) {
    try {
      const currentConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      currentConfig.hub_version = 5;
      currentConfig.migration_pending = true;
      fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
    } catch (e) {
      console.error("Failed to update config during migration:", e);
    }
  }
}

export function seedPortalREADME(knowledgePath: string, language: string = "en"): void {
  const readmePath = path.join(knowledgePath, "README.md");
  if (fs.existsSync(readmePath)) return;

  const contentEn = `# 📚 LIBRARIAN KNOWLEDGE HUB

Welcome to your personal "Knowledge OS". This Hub is managed by the AI Librarian and optimized for both live reading in Obsidian/SilverBullet and deep analysis by artificial intelligence.

> [!tip] WHERE TO START?
> ## 🗺️ [[wiki/PROJECT_MAP|OPEN PROJECT & KNOWLEDGE MAP]]
> Start here to see the tree of all active projects and global concepts.

---

## 🏗️ Hub Architecture

The knowledge base is divided into two key zones:

1.  📂 **[[wiki/|wiki/]] (The Sanctuary)**: 
    *   This is the structured core of the base. 
    *   This is where knowledge "quanta" with YAML metadata and mutual links live. 
    *   **Rule**: Editing here should ideally be performed through Librarian tools to maintain integrity.

2.  📂 **[[raw/|raw/]] (The Sandbox)**: 
    *   Free information dump zone.
    *   Logs, dumps, on-the-fly notes, and raw materials go here.
    *   **Rule**: The Librarian does not monitor the structure of this folder, but can take data from here to synthesize new wiki nodes.

---

<details>
<summary>🛠️ Technical Information (For Developers)</summary>

### ⚙️ Management Stack
This Hub is served by three MCP servers:
- **Librarian Hub**: File management and validation.
- **Librarian Git**: Versioning (Draft/Master protocol).
- **Librarian Search**: Semantic search and vectorization.

### 📜 Core Instructions
The complete set of system rules is located in the file \`[[.librarian/INSTRUCTIONS|CORE INSTRUCTIONS]]\`.

### 🚀 Commands
If you are using Gemini CLI or another agent:
- \`check_health\` — check base for broken links.
- \`update_project_map\` — update project map.
- \`semantic_search\` — find information by meaning.

</details>

---
*Librarian is watching. Knowledge crystallization in progress...*
`;

  const contentRu = `# 📚 LIBRARIAN KNOWLEDGE HUB

Добро пожаловать в вашу персональную «ОС Знаний». Этот Хаб управляется ИИ-Библиотекарем и оптимизирован как для живого чтения в Obsidian/SilverBullet, так и для глубокого анализа искусственным интеллектом.

> [!tip] С ЧЕГО НАЧАТЬ?
> ## 🗺️ [[wiki/PROJECT_MAP|ОТКРЫТЬ КАРТУ ПРОЕКТОВ И ЗНАНИЙ]]
> Начните отсюда, чтобы увидеть дерево всех активных проектов и глобальных концепций.

---

## 🏗️ Архитектура Хаба

База знаний разделена на две ключевые зоны:

1.  📂 **[[wiki/|wiki/]] (Святилище)**: 
    *   Это структурированное ядро базы. 
    *   Здесь живут «кванты» знаний с YAML-метаданными и взаимными ссылками. 
    *   **Правило**: Редактирование здесь желательно проводить через инструменты Библиотекаря для сохранения целостности.

2.  📂 **[[raw/|raw/]] (Песочница)**: 
    *   Зона свободного сброса информации.
    *   Сюда попадают логи, дампы, заметки «на лету» и необработанное сырье.
    *   **Правило**: Библиотекарь не следит за структурой этой папки, но может брать отсюда данные для синтеза новых вики-узлов.

---

<details>
<summary>🛠️ Техническая информация (Для разработчиков)</summary>

### ⚙️ Стек управления
Данный Хаб обслуживается тремя MCP-серверами:
- **Librarian Hub**: Управление файлами и валидация.
- **Librarian Git**: Версионирование (Draft/Master протокол).
- **Librarian Search**: Семантический поиск и векторизация.

### 📜 Основные инструкции
Полный свод системных правил находится в файле \`[[.librarian/INSTRUCTIONS|CORE INSTRUCTIONS]]\`.

### 🚀 Команды
Если вы используете Gemini CLI или другой агент:
- \`check_health\` — проверить базу на битые ссылки.
- \`update_project_map\` — обновить карту проектов.
- \`semantic_search\` — найти информацию по смыслу.

</details>

---
*Librarian is watching. Кристаллизация знаний в процессе...*
`;

  const finalContent = language === "ru" ? contentRu : contentEn;
  fs.writeFileSync(readmePath, finalContent, "utf-8");
}

export function initializeHub(knowledgePath: string, configPath: string): void {
  // 1. Legacy Migration (v1 -> v2)
  const legacyMetaPath = path.join(knowledgePath, "meta");
  const newLibrarianPath = path.join(knowledgePath, ".librarian");

  if (fs.existsSync(legacyMetaPath) && !fs.existsSync(newLibrarianPath)) {
    console.error("Migrating legacy 'meta/' to '.librarian/'...");
    fs.renameSync(legacyMetaPath, newLibrarianPath);
  }

  // 2. Directory Structure
  const dirs = ["raw", "wiki", ".librarian", "wiki/Projects", "wiki/_Global", ".librarian/templates"];
  dirs.forEach((d) => {
    const full = path.join(knowledgePath, d);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  });

  // 3. Config Enforcement & Hub Identity Protocol
  let currentConfig = { ...DEFAULT_CONFIG };
  if (fs.existsSync(configPath)) {
    const rawConfig = fs.readFileSync(configPath, "utf-8");
    
    // --- IDENTITY SPLIT HANDLING (JSON CONFLICT RESOLUTION) ---
    if (rawConfig.includes("<<<<<<< HEAD")) {
      console.error("Detected Git conflict in config.json. Applying Identity Split resolution...");
      const conflictRegex = /<<<<<<< HEAD([\s\S]*?)=======([\s\S]*?)>>>>>>> .*/g;
      const matches = [...rawConfig.matchAll(conflictRegex)];
      
      if (matches.length > 0) {
        try {
          const versionA = JSON.parse(matches[0][1]);
          const versionB = JSON.parse(matches[0][2]);
          
          const idA = versionA.hub_id;
          const idB = versionB.hub_id;
          
          let winningId = idA;
          let losingId = idB;
          
          // Deterministic selection (e.g., lexical sort) to ensure both sides pick the same winner
          if (idA && idB && idA !== idB) {
            if (idB > idA) {
              winningId = idB;
              losingId = idA;
            }
            console.error(`Resolved Identity Split: Winner (${winningId}), Loser preserved as alias (${losingId})`);
          }
          
          // Merge configurations (prioritizing Version A as base)
          currentConfig = { ...DEFAULT_CONFIG, ...versionA, hub_id: winningId };
          currentConfig.hub_aliases = Array.from(new Set([
            ...(versionA.hub_aliases || []), 
            ...(versionB.hub_aliases || []),
            losingId
          ])).filter(Boolean);
          
          // Rewrite the resolved config
          fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
          
          // Auto-commit the resolution
          execSync("git add .librarian/config.json", { cwd: knowledgePath, stdio: "ignore" });
          execSync("git commit -m \"chore(system): resolve Identity Split in config.json\"", { cwd: knowledgePath, stdio: "ignore" });
          
        } catch (e) {
          console.error("Failed to parse conflicted config JSON. Resetting to defaults.", e);
        }
      }
    } else {
      // Normal JSON Parsing
      try {
        const saved = JSON.parse(rawConfig);
        currentConfig = { ...DEFAULT_CONFIG, ...saved };
      } catch {
        console.error("Config corrupted, resetting to defaults.");
      }
    }
  }

  // Generate Hub ID if missing
  let identityGenerated = false;
  if (!currentConfig.hub_id) {
    currentConfig.hub_id = `hub-${crypto.randomUUID()}`;
    currentConfig.hub_aliases = currentConfig.hub_aliases || [];
    identityGenerated = true;
    console.error(`Generated new Hub Identity: ${currentConfig.hub_id}`);
  }

  // Ensure we always have the latest version in memory
  if (currentConfig.hub_version < LATEST_HUB_VERSION) {
    console.error(`Upgrading Hub from v${currentConfig.hub_version} to v${LATEST_HUB_VERSION}`);
    if (currentConfig.hub_version === 5) {
      console.error("v5 Migration: Enabling Git Structural Audit...");
    }
    if (currentConfig.hub_version < 6) {
      migrateV5toV6_Indices(knowledgePath);
    }
    currentConfig.hub_version = LATEST_HUB_VERSION;
  }
  fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));

  // 3.5 System Commit for Identity (if generated)
  if (identityGenerated && fs.existsSync(path.join(knowledgePath, ".git"))) {
    try {
      const currentBranch = execSync("git branch --show-current", { cwd: knowledgePath }).toString().trim();
      
      // Temporarily switch to master to stamp identity
      if (currentBranch !== "master") {
        execSync("git checkout master", { cwd: knowledgePath, stdio: "ignore" });
      }
      
      execSync("git add .librarian/config.json", { cwd: knowledgePath, stdio: "ignore" });
      execSync(`git commit -m "chore(system): assign unique hub identity ${currentConfig.hub_id}"`, { cwd: knowledgePath, stdio: "ignore" });
      
      // Return to original branch and merge identity
      if (currentBranch !== "master") {
        execSync(`git checkout ${currentBranch}`, { cwd: knowledgePath, stdio: "ignore" });
        execSync("git merge master -m \"chore(system): sync hub identity from master\"", { cwd: knowledgePath, stdio: "ignore" });
      }
    } catch (e) {
      console.error("Failed to commit system identity. Ensure git is configured.", e);
    }
  }

  // 5. Git Constitution Enforcement
  const gitignorePath = path.join(knowledgePath, ".gitignore");
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
    execSync("git rev-parse --is-inside-work-tree", { cwd: knowledgePath });
  } catch {
    execSync("git init", { cwd: knowledgePath });
    console.error("Initialized new Git repository in Hub.");
  }

  // 7. Seed AI Instructions & Templates
  seedInstructions(knowledgePath, configPath);
  seedTemplates(knowledgePath);
  seedPortalREADME(knowledgePath, currentConfig.language);
}
