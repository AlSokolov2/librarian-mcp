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
}

export const ALLOWED_ROOT_DIRS = ["wiki", "raw", ".librarian", ".git", ".obsidian"];
export const ALLOWED_ROOT_FILES = ["README.md", ".gitignore"];

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
  config: LibrarianConfig
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
    
    // Check required fields
    for (const field of config.required_yaml_fields) {
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
