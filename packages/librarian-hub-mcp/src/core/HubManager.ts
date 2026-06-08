import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  validateAndEnforceRules,
  applyTemplateIfNew,
  getStructuralViolations,
  getDuplicateLinks,
  classifyStrayFile,
  type LibrarianConfig
} from "@librarian/shared";

const PROJECT_MAP_REL_PATH = "wiki/PROJECT_MAP.md";

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
    const projectMapExists = fs.existsSync(path.join(this.knowledgePath, PROJECT_MAP_REL_PATH));

    const allDuplicates: string[] = [];
    for (const file of wikiFiles) {
      const fileContent = fs.readFileSync(file, "utf-8");
      const dupes = getDuplicateLinks(fileContent);
      if (dupes.length > 0) {
        allDuplicates.push(`${path.relative(this.knowledgePath, file)}: ${dupes.join(", ")}`);
      }
    }

    // SMART CURATION CLASSIFICATION
    const ghosts: string[] = [];
    const misplacedNodes: string[] = [];
    const rawSources: string[] = [];
    const technicalTrash: string[] = [];

    strayFiles.forEach((file) => {
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
      `Project Map Status: ${projectMapExists ? "OK" : "MISSING (CRITICAL)"}`,
      `Current Branch: ${currentBranch}`,
      `Illegal Branches Found: ${illegalBranches.length}`,
      `Git Index Status: ${gitDirty ? "DIRTY" : "CLEAN"}`,
      `Broken links: ${brokenLinks.length}`,
      `Orphans: ${orphans.length}`,
      `Stray Items in Root: ${strayFiles.length}`,
      "",
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
      brokenLinks.length > 0 ? "\nBroken Links:\n" + brokenLinks.join("\n") : "",
      orphans.length > 0 ? "\nOrphaned Nodes: " + orphans.join(", ") : "",
      illegalBranches.length > 0
        ? "\nRECOMMENDATION: Use 'git_consolidate_branches' to enforce Two-Branch Protocol."
        : strayFiles.length > 0
        ? "\nRECOMMENDATION: Use 'apply_cleanup' to resolve stray files (ghosts will be deleted, others moved)."
        : gitDirty
        ? "\nRECOMMENDATION: Commit changes to crystallize state."
        : "Status: ARCHITECTURAL INTEGRITY VERIFIED.",
    ]
      .filter(Boolean)
      .join("\n");

    return report;
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

    items.forEach((item) => {
      const full = path.join(this.knowledgePath, item);
      if (!fs.existsSync(full) && !item.startsWith(".")) {
        ignored.push(item + " (not found)");
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

  public updateProjectMap(): string {
    const projectsDir = path.join(this.knowledgePath, "wiki", "Projects");
    const globalDir = path.join(this.knowledgePath, "wiki", "_Global");
    const projects = fs.existsSync(projectsDir)
      ? fs
          .readdirSync(projectsDir)
          .filter((f) => fs.statSync(path.join(projectsDir, f)).isDirectory())
      : [];
    const globalNodes = fs.existsSync(globalDir)
      ? fs.readdirSync(globalDir).filter((f) => !f.startsWith("."))
      : [];

    // Deduplicate and sort
    const projectLinks = Array.from(new Set(projects))
      .sort()
      .map((p) => `- [[${p}]]`);
    const globalLinks = Array.from(new Set(globalNodes.map((g) => g.replace(".md", ""))))
      .sort()
      .map((g) => `- [[${g}]]`);

    const mapContent =
      "# MAP OF PROJECTS & KNOWLEDGE NODES\n\n## 📂 Projects\n" +
      projectLinks.join("\n") +
      "\n\n## 🌐 Global Nodes\n" +
      globalLinks.join("\n");
    fs.writeFileSync(path.join(this.knowledgePath, PROJECT_MAP_REL_PATH), mapContent, "utf-8");
    return "Map updated.";
  }
}
