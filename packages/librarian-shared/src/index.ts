import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

export interface LibrarianConfig {
  naming_convention: string;
  required_yaml_fields: string[];
  auto_update_date: true;
  main_branch: string;
  hub_version: number;
  allowed_text_extensions: string[];
  language: string;
  migration_pending?: boolean;
  hub_id?: string;
  hub_aliases?: string[];
}

export interface GitAuditResult {
  current_branch: string;
  illegal_branches: string[];
  is_dirty: boolean;
}

export const ALLOWED_ROOT_DIRS = ["wiki", "raw", ".librarian", ".git", ".obsidian"];
export const ALLOWED_ROOT_FILES = ["README.md", ".gitignore"];

export const MANDATORY_BRANCHES = ["master", "draft"];

/**
 * Находит файлы и папки, нарушающие структуру корня
 */
export function getStructuralViolations(knowledgePath: string): string[] {
  if (!fs.existsSync(knowledgePath)) return [];
  const rootItems = fs.readdirSync(knowledgePath);
  return rootItems.filter(item => {
    return !ALLOWED_ROOT_DIRS.includes(item) && !ALLOWED_ROOT_FILES.includes(item);
  });
}

/**
 * Находит дублирующиеся вики-ссылки в контенте
 */
export function getDuplicateLinks(content: string): string[] {
  const links = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  links.forEach(link => {
    const target = link.replace(/[[\]]/g, "").split("|")[0].trim();
    if (seen.has(target)) {
      duplicates.add(target);
    } else {
      seen.add(target);
    }
  });

  return Array.from(duplicates);
}

/**
 * Валидатор контента согласно Конституции
 */
export function validateAndEnforceRules(
  relPath: string, 
  content: string, 
  config: LibrarianConfig,
  knowledgePath: string
): { valid: boolean; content: string; error?: string } {
  const isWiki = relPath.startsWith("wiki/");
  const fileName = path.basename(relPath);
  
  if (isWiki && fileName !== "index.md") {
    const namingRegex = new RegExp(config.naming_convention);
    const cleanName = fileName.replace(".md", "");
    if (!namingRegex.test(cleanName)) {
      return { 
        valid: false, 
        content, 
        error: `Naming violation. File in wiki must match: ${config.naming_convention}` 
      };
    }
  }

  if (isWiki) {
    const parsed = matter(content);

    // --- DECENTRALIZED SCHEMA ---
    const dirName = path.dirname(relPath);
    const indexPath = path.join(knowledgePath, dirName, "index.md");
    let localRequiredYaml: string[] = [];
    let localRequiredHeaders: string[] = [];
    
    if (fs.existsSync(indexPath) && fileName !== "index.md") {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      const indexMatter = matter(indexContent);
      if (indexMatter.data?.enforce_schema) {
        const schema = indexMatter.data.enforce_schema;
        if (Array.isArray(schema.required_yaml)) localRequiredYaml = schema.required_yaml;
        if (Array.isArray(schema.required_headers)) localRequiredHeaders = schema.required_headers;
      }
    }

    const allRequiredYaml = Array.from(new Set([...config.required_yaml_fields, ...localRequiredYaml]));
    
    // Check required fields
    for (const field of allRequiredYaml) {
      if (!parsed.data || !parsed.data[field]) {
        return { 
          valid: false, 
          content, 
          error: `Missing required YAML field: ${field}` 
        };
      }
    }

    if (config.auto_update_date) {
      parsed.data.last_updated = new Date().toISOString().split('T')[0];
    }
    
    if (!parsed.content.trim().startsWith("# ")) {
      return { 
        valid: false, 
        content, 
        error: "Missing H1 header (# Title)" 
      };
    }

    // Graceful degradation for headers
    for (const header of localRequiredHeaders) {
      if (!parsed.content.includes(header)) {
        parsed.content += `\n\n${header}\n> [!todo] REQUIRE_HUMAN_INPUT: Данные для раздела отсутствуют в сыром источнике.\n`;
      }
    }

    return { valid: true, content: matter.stringify(parsed.content, parsed.data) };
  }

  return { valid: true, content };
}

/**
 * Применение шаблонов с умным слиянием
 */
export function applyTemplateIfNew(
  relPath: string, 
  incomingContent: string, 
  knowledgePath: string
): string {
  const fullPath = path.join(knowledgePath, relPath);
  if (fs.existsSync(fullPath)) return incomingContent;

  if (!relPath.startsWith("wiki/")) return incomingContent;

  const fileName = path.basename(relPath, ".md");
  const templateName = relPath.includes("Projects/") ? "Project_Template.md" : "Entity_Template.md";
  const templatePath = path.join(knowledgePath, ".librarian", "templates", templateName);
  
  if (!fs.existsSync(templatePath)) return incomingContent;

  const templateRaw = fs.readFileSync(templatePath, "utf-8");
  const templateParsed = matter(templateRaw);
  const incomingParsed = matter(incomingContent);

  const finalData = {
    ...templateParsed.data,
    ...incomingParsed.data,
    tags: Array.from(new Set([...(templateParsed.data.tags || []), ...(incomingParsed.data.tags || [])])),
    sources: Array.from(new Set([...(templateParsed.data.sources || []), ...(incomingParsed.data.sources || [])])),
  };

  const finalTitle = fileName.replace(/_/g, " ");
  let finalBody = templateParsed.content.replace(/{{title}}/g, finalTitle);

  const contentToInsert = incomingParsed.content.trim();
  if (contentToInsert) {
    finalBody = finalBody.replace(/(## (?:Обзор|Описание)\n)([^#]*)/, `$1${contentToInsert}\n`);
  }

  return matter.stringify(finalBody, finalData);
}

/**
 * Resolves Git conflict markers using the Accumulative Merge protocol (preserving both versions in Markdown).
 */
export function resolveConflictsMarkdown(content: string, sourceBranch: string): string {
  // Regex to match standard git conflict markers
  const conflictRegex = /<<<<<<< HEAD([\s\S]*?)=======([\s\S]*?)>>>>>>> .*/g;

  return content.replace(conflictRegex, (match, versionA, versionB) => {
    return `<!-- LIBRARIAN_CONFLICT_START -->
> [!CAUTION] CONFLICT: Draft vs ${sourceBranch}
> **Version A (Current Draft):**
${versionA.trim().split("\n").map((line: string) => `> ${line}`).join("\n")}
>
> ---
> **Version B (Incoming ${sourceBranch}):**
${versionB.trim().split("\n").map((line: string) => `> ${line}`).join("\n")}
<!-- LIBRARIAN_CONFLICT_END -->`;
  });
}

export type StrayFileCategory = "GHOST" | "NODE" | "SOURCE" | "TRASH";

/**
 * Classifies a stray file found in the root directory.
 */
export function classifyStrayFile(
  fileName: string,
  content: string,
  wikiFileBaseNames: string[],
  allowedExtensions: string[]
): StrayFileCategory {
  const baseName = path.basename(fileName, ".md");
  const ext = path.extname(fileName).toLowerCase();

  // 1. Ghost Duplicate (exists in wiki)
  if (wikiFileBaseNames.includes(baseName)) {
    return "GHOST";
  }

  // 2. Misplaced Node (has YAML)
  if (ext === ".md" && content.trim().startsWith("---")) {
    return "NODE";
  }

  // 3. Raw Source (text-based but no YAML)
  if (allowedExtensions.includes(ext)) {
    return "SOURCE";
  }

  return "TRASH";
}

/**
 * Находит папки в wiki/, в которых отсутствует index.md
 */
export function getMissingIndices(knowledgePath: string): string[] {
  const wikiPath = path.join(knowledgePath, "wiki");
  if (!fs.existsSync(wikiPath)) return [];

  const missing: string[] = [];
  
  function walk(dir: string) {
    const items = fs.readdirSync(dir);
    const hasIndex = items.some(item => item.toLowerCase() === "index.md");
    const relDir = path.relative(knowledgePath, dir);

    // Проверяем только подпапки wiki/ (корневой README.md игнорируем здесь)
    // Сам каталог wiki/ тоже должен иметь index.md
    if (!hasIndex && relDir.startsWith("wiki")) {
      missing.push(relDir);
    }

    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory() && !item.startsWith(".")) {
        walk(fullPath);
      }
    }
  }

  walk(wikiPath);
  return missing;
}

/**
 * Генерирует контент index.md для папки на основе её содержимого
 */
export function generateFolderIndex(
  folderName: string, 
  files: { name: string; summary?: string }[], 
  subfolders: string[]
): string {
  const title = folderName === "wiki" ? "Knowledge Sanctuary" : folderName.replace(/_/g, " ");
  
  let moc = files
    .filter(f => f.name.toLowerCase() !== "index.md" && f.name.toLowerCase() !== "readme.md")
    .map(f => `* [[${f.name.replace(".md", "")}]] — ${f.summary || "Описание в процессе..."}`)
    .join("\n");
    
  if (subfolders.length > 0) {
    moc += "\n\n### 📂 Подразделы\n" + subfolders.map(s => `* [[${s}/index|${s.replace(/_/g, " ")}]]`).join("\n");
  }

  // Базовая Mermaid диаграмма
  let mermaid = "```mermaid\ngraph TD\n";
  mermaid += `    Index[${title}] --> Files[Документы]\n`;
  if (subfolders.length > 0) {
    mermaid += `    Index --> Subs[Подпапки]\n`;
  }
  mermaid += "```";

  const footer = folderName === "wiki" 
    ? "[[README|назад к Порталу]]" 
    : "[[wiki/index|назад на Главную]]";

  return `# ${title}

> [!abstract]
> Концептуальный узел, объединяющий знания по теме "${title}".

---

## 🗺️ Карта Контента (MOC)
${moc || "В этой папке пока нет документов."}

---

## 📊 Визуализация
${mermaid}

---
${footer}
`;
}


