import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  validateAndEnforceRules,
  applyTemplateIfNew,
  getStructuralViolations,
  getDuplicateLinks,
  classifyStrayFile,
  getMissingIndices,
  generateFolderIndex,
  type LibrarianConfig
} from "@librarian/shared";

export class HubManager {
  constructor(
    private readonly knowledgePath: string,
    private readonly hubConfig: LibrarianConfig
  ) {}

  public readFile(relPath: string): string {
    const fullPath = path.join(this.knowledgePath, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${relPath}`);
    }
    return fs.readFileSync(fullPath, "utf-8");
  }

  public writeFileRaw(relPath: string, content: string): string {
    const fullPath = path.join(this.knowledgePath, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    return `File written to ${relPath}`;
  }

  public grepSearch(query: string): string {
    const result = execSync(
      `grep -rEi "${query}" "${this.knowledgePath}" --exclude-dir=.git --exclude-dir=.librarian || true`
    ).toString();
    return result || "Nothing found.";
  }

  public validateContent(relPath: string, content: string): string {
    const val = validateAndEnforceRules(relPath, content, this.hubConfig);
    return JSON.stringify(val, null, 2);
  }

  public applyTemplate(relPath: string, content: string): string {
    return applyTemplateIfNew(relPath, content, this.knowledgePath);
  }

  public checkHealth(): string {
    const wikiRoot = path.join(this.knowledgePath, "wiki");
    const wikiFiles = execSync(`find "${wikiRoot}" -name "*.md"`)
      .toString()
      .split("\n")
      .filter(Boolean);
    const fileBaseNames = wikiFiles.map((f) => path.basename(f, ".md"));
    const brokenLinks: string[] = [];
    const linkMap: Record<string, string[]> = {};

    for (const file of wikiFiles) {
      const fileContent = fs.readFileSync(file, "utf-8");
      const relPath = path.relative(this.knowledgePath, file);
      const links = fileContent.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
      links.forEach((link) => {
        const target = link.replace(/[[\]]/g, "").split("|")[0].trim();
        const targetExists =
          fileBaseNames.includes(target) ||
          fs.existsSync(path.join(this.knowledgePath, "raw", target)) ||
          fs.existsSync(path.join(this.knowledgePath, "raw", target + ".md")) ||
          fs.existsSync(path.join(this.knowledgePath, target + ".md"));
        if (!targetExists) brokenLinks.push(`${relPath}: broken link to [[${target}]]`);
        if (!linkMap[target]) linkMap[target] = [];
        linkMap[target].push(relPath);
      });
    }
    const orphans = fileBaseNames.filter((n) => !linkMap[n] && n !== "PROJECT_MAP");
    const strayFiles = getStructuralViolations(this.knowledgePath);

    const isolatedItems = this.getIsolatedItems();
    const activeStrayFiles = strayFiles.filter(f => !isolatedItems.includes(f));

    const allDuplicates: string[] = [];
    for (const file of wikiFiles) {
      const fileContent = fs.readFileSync(file, "utf-8");
      const dupes = getDuplicateLinks(fileContent);
      if (dupes.length > 0) {
        allDuplicates.push(`${path.relative(this.knowledgePath, file)}: ${dupes.join(", ")}`);
      }
    }

    const missingIndices = getMissingIndices(this.knowledgePath);

    // SMART CURATION CLASSIFICATION
    const ghosts: string[] = [];
    const misplacedNodes: string[] = [];
    const rawSources: string[] = [];
    const technicalTrash: string[] = [];

    activeStrayFiles.forEach((file) => {
      const fullPath = path.join(this.knowledgePath, file);
      if (!fs.existsSync(fullPath)) return;

      // --- BUGFIX: Check if it's a file before reading to avoid EISDIR ---
      if (!fs.statSync(fullPath).isFile()) return;

      const content = fs.readFileSync(fullPath, "utf-8");
      const category = classifyStrayFile(
        file,
        content,
        fileBaseNames,
        this.hubConfig.allowed_text_extensions
      );

      if (category === "GHOST") ghosts.push(file);
      else if (category === "NODE") misplacedNodes.push(file);
      else if (category === "SOURCE") rawSources.push(file);
      else technicalTrash.push(file);
    });

    // Git Structural Audit (Two-Branch Protocol)
    let gitDirty = false;
    let illegalBranches: string[] = [];
    let currentBranch = "master";
    try {
      const status = execSync("git status --short", { cwd: this.knowledgePath }).toString();
      gitDirty = status.length > 0;
      currentBranch = execSync("git branch --show-current", { cwd: this.knowledgePath })
        .toString()
        .trim();
      const allBranches = execSync("git branch", { cwd: this.knowledgePath })
        .toString()
        .split("\n")
        .map((b) => b.trim().replace("* ", ""));
      illegalBranches = allBranches.filter(
        (b) => b && b !== "master" && b !== "draft" && !b.startsWith("(HEAD")
      );
    } catch {
      console.error("Git audit failed");
    }

    const report = [
      "--- LIBRARIAN HUB HEALTH REPORT ---",
      `Current Branch: ${currentBranch}`,
      `Illegal Branches Found: ${illegalBranches.length}`,
      `Git Index Status: ${gitDirty ? "DIRTY" : "CLEAN"}`,
      `Broken links: ${brokenLinks.length}`,
      `Orphans: ${orphans.length}`,
      `Missing Folder Indices: ${missingIndices.length}`,
      `Stray Items in Root: ${activeStrayFiles.length}`,
      `Isolated Items: ${isolatedItems.length}`,
      "",
      missingIndices.length > 0
        ? "!!! MISSING FOLDER INDICES (REQUIRED) !!!\n" +
          missingIndices.map((m) => `- ${m}`).join("\n")
        : "",
      illegalBranches.length > 0
        ? "!!! ILLEGAL BRANCHES FOUND (MANDATORY CONSOLIDATION REQUIRED) !!!\n" +
          illegalBranches.map((b) => `- ${b}`).join("\n")
        : "",
      ghosts.length > 0
        ? "!!! GHOST DUPLICATES FOUND (RECOMMEND: DELETE) !!!\n" +
          ghosts.map((f) => `- ${f} (Exists in wiki/)`).join("\n")
        : "",
      misplacedNodes.length > 0
        ? "!!! MISPLACED NODES FOUND (RECOMMEND: MOVE TO WIKI) !!!\n" +
          misplacedNodes.map((f) => `- ${f}`).join("\n")
        : "",
      rawSources.length > 0
        ? "!!! UNPROCESSED SOURCES FOUND (RECOMMEND: MOVE TO RAW) !!!\n" +
          rawSources.map((f) => `- ${f}`).join("\n")
        : "",
      technicalTrash.length > 0
        ? "!!! TECHNICAL TRASH FOUND (RECOMMEND: DELETE) !!!\n" +
          technicalTrash.map((f) => `- ${f}`).join("\n")
        : "",
      isolatedItems.length > 0
        ? "!!! ISOLATED VIOLATIONS PRESENT (STATUS: STAINED) !!!\n" +
          isolatedItems.map((f) => `- ${f} (Ignored by Git)`).join("\n")
        : "",
      brokenLinks.length > 0 ? "\nBroken Links:\n" + brokenLinks.join("\n") : "",
      orphans.length > 0 ? "\nOrphaned Nodes: " + orphans.join(", ") : "",
      illegalBranches.length > 0
        ? "\nRECOMMENDATION: Use 'git_consolidate_branches' to enforce Two-Branch Protocol."
        : missingIndices.length > 0
        ? "\nRECOMMENDATION: Use 'repair_indices' to automatically generate missing README.md files."
        : activeStrayFiles.length > 0
        ? "\nRECOMMENDATION: Use 'apply_cleanup' to resolve stray files (ghosts will be deleted, others moved, or use 'isolate' to ignore)."
        : gitDirty
        ? "\nRECOMMENDATION: Commit changes to crystallize state."
        : isolatedItems.length > 0
        ? "Status: STAINED (Isolated violations present)."
        : "Status: ARCHITECTURAL INTEGRITY VERIFIED.",
    ]
      .filter(Boolean)
      .join("\n");

    return report;
  }

  public repairIndices(): string {
    const missing = getMissingIndices(this.knowledgePath);
    if (missing.length === 0) return "No missing indices found.";

    const repaired: string[] = [];

    for (const relDir of missing) {
      const fullDir = path.join(this.knowledgePath, relDir);
      const items = fs.readdirSync(fullDir);
      
      const files = items
        .filter(item => item.endsWith(".md") && item.toLowerCase() !== "readme.md" && item.toLowerCase() !== "index.md")
        .map(name => {
          // Попытка извлечь краткое описание (например, первую строку после H1)
          const content = fs.readFileSync(path.join(fullDir, name), "utf-8");
          const lines = content.split("\n").filter(l => l.trim() !== "" && !l.startsWith("---") && !l.startsWith("#"));
          const summary = lines.length > 0 ? lines[0].trim() : undefined;
          return { name, summary };
        });

      const subfolders = items.filter(item => fs.statSync(path.join(fullDir, item)).isDirectory() && !item.startsWith("."));

      const readmeContent = generateFolderIndex(path.basename(relDir), files, subfolders);
      const readmePath = path.join(relDir, "index.md");
      this.writeFileRaw(readmePath, readmeContent);
      repaired.push(readmePath);
    }

    return `INDEX REPAIR COMPLETED:\n- Created ${repaired.length} index files.\nDetails:\n` + repaired.map(r => `- ${r}`).join("\n");
  }

  public applyCleanup(items: string[]): string {
    const wikiFiles = execSync(`find "${path.join(this.knowledgePath, "wiki")}" -name "*.md"`)
      .toString()
      .split("\n")
      .filter(Boolean);
    const fileBaseNames = wikiFiles.map((f) => path.basename(f, ".md"));

    const deleted: string[] = [];
    const moved: string[] = [];
    const gitPurged: string[] = [];
    const ignored: string[] = [];

    const isolatedItems = this.getIsolatedItems();

    items.forEach((item) => {
      const full = path.join(this.knowledgePath, item);
      if (!fs.existsSync(full) && !item.startsWith(".")) {
        ignored.push(item + " (not found)");
        return;
      }

      if (isolatedItems.includes(item)) {
        ignored.push(item + " (protected by isolation)");
        return;
      }

      // 1. Handle explicit Git Index Purge for system files
      const isUI = item.startsWith(".obsidian") || item.startsWith(".idea") || item.startsWith(".vscode");
      const isInternal = item.startsWith(".librarian");
      if (isUI || isInternal) {
        try {
          execSync(`git rm -r --cached "${item}"`, { cwd: this.knowledgePath });
          gitPurged.push(item);
        } catch {
          ignored.push(item + " (git-rm failed)");
        }
        return;
      }

      // --- BUGFIX: Only read content if it's a file ---
      const isFile = fs.statSync(full).isFile();
      let category = "TRASH";
      
      if (isFile) {
        const content = fs.readFileSync(full, "utf-8");
        category = classifyStrayFile(
          item,
          content,
          fileBaseNames,
          this.hubConfig.allowed_text_extensions
        );
      }

      if (category === "GHOST") {
        fs.unlinkSync(full);
        deleted.push(item + " (Ghost)");
      } else if (category === "NODE") {
        const dest = path.join(this.knowledgePath, "wiki", "_Global", item);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(full, dest);
        moved.push(`${item} -> wiki/_Global/`);
      } else if (category === "SOURCE") {
        const dest = path.join(this.knowledgePath, "raw", item);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(full, dest);
        moved.push(`${item} -> raw/`);
      } else {
        if (fs.statSync(full).isDirectory()) {
          fs.rmSync(full, { recursive: true, force: true });
        } else {
          fs.unlinkSync(full);
        }
        deleted.push(item + " (Trash)");
      }
    });

    // Sync index
    try {
      execSync("git add -A", { cwd: this.knowledgePath });
    } catch (e) {
      console.error("Final git sync failed:", e);
    }

    let msg = `SMART CLEANUP RESULT:\n- Deleted: ${deleted.length} items.\n- Moved: ${moved.length} items.`;
    if (gitPurged.length > 0) msg += `\n- Git Purged: ${gitPurged.length} items.`;
    if (moved.length > 0) msg += `\nDetails (Moved):\n` + moved.map((m) => `- ${m}`).join("\n");
    if (deleted.length > 0) msg += `\nDetails (Deleted):\n` + deleted.map((d) => `- ${d}`).join("\n");

    return msg;
  }

  public isolateArtifacts(items: string[]): string {
    const gitignorePath = path.join(this.knowledgePath, ".gitignore");
    let content = "";
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, "utf-8");
    }

    const sectionHeader = "\n# LIBRARIAN ISOLATED ARTIFACTS";
    if (!content.includes(sectionHeader)) {
      content += sectionHeader + "\n";
    }

    const added: string[] = [];
    const existing = this.getIsolatedItems();

    items.forEach((item) => {
      if (!existing.includes(item)) {
        content += `${item}\n`;
        added.push(item);
      }
    });

    fs.writeFileSync(gitignorePath, content, "utf-8");
    
    return added.length > 0 
      ? `ISOLATION SUCCESSFUL:\n- Added to .gitignore: ${added.join(", ")}`
      : "No new items to isolate (already in .gitignore or not found).";
  }

  private getIsolatedItems(): string[] {
    const gitignorePath = path.join(this.knowledgePath, ".gitignore");
    if (!fs.existsSync(gitignorePath)) return [];

    const content = fs.readFileSync(gitignorePath, "utf-8");
    const sectionHeader = "# LIBRARIAN ISOLATED ARTIFACTS";
    const index = content.indexOf(sectionHeader);
    if (index === -1) return [];

    return content
      .slice(index + sectionHeader.length)
      .split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"));
  }
}
