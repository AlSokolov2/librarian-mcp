import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveConflictsMarkdown } from "@librarian/shared";

export class GitManager {
  private knowledgePath: string;

  constructor(knowledgePath: string) {
    this.knowledgePath = knowledgePath;
  }

  private execCommand(command: string): string {
    try {
      return execSync(command, { 
        cwd: this.knowledgePath,
        stdio: ["ignore", "pipe", "pipe"] 
      }).toString();
    } catch (error: unknown) {
      const err = error as Record<string, unknown>;
      const stderr = (err.stderr as Buffer | undefined)?.toString().trim() || "";
      const stdout = (err.stdout as Buffer | undefined)?.toString().trim() || "";
      const message = (err.message as string | undefined) || "Unknown error";
      throw new Error(`Git command failed: ${command}\n${stderr || stdout || message}`, { cause: error });
    }
  }

  private ensureInitialCommit(): void {
    if (!fs.existsSync(path.join(this.knowledgePath, ".git"))) {
      this.execCommand("git init");
    }

    try {
      this.execCommand("git rev-parse --verify HEAD");
    } catch {
      // Empty repository - perform cold start
      const libDir = path.join(this.knowledgePath, ".librarian");
      if (!fs.existsSync(libDir)) {
        fs.mkdirSync(libDir, { recursive: true });
      }
      
      const instructionsPath = path.join(libDir, "INSTRUCTIONS.md");
      if (!fs.existsSync(instructionsPath)) {
        fs.writeFileSync(
          instructionsPath, 
          "# LIBRARIAN KNOWLEDGE BASE\n\nThis repository is managed by the Librarian Protocol. Do not modify the structure manually.\n", 
          "utf-8"
        );
      }

      this.execCommand("git add .");
      
      try {
        this.execCommand("git config user.name 'Librarian Hub'");
        this.execCommand("git config user.email 'librarian@example.com'");
      } catch {
        // Ignore config errors
      }
      this.execCommand('git commit -m "feat: initial knowledge base setup"');
    }

    // Ensure the initial branch is named 'master'
    const current = this.showCurrentBranch();
    if (current && current !== "master") {
      const branches = this.execCommand("git branch")
        .split("\n")
        .map((b) => b.trim().replace("* ", ""));
      
      if (!branches.includes("master")) {
        this.execCommand(`git branch -m ${current} master`);
      }
    }
  }

  private resolveConflictsMarkdownInternal(conflictPath: string, sourceBranch: string): void {
    const fullPath = path.join(this.knowledgePath, conflictPath);
    if (!fs.existsSync(fullPath)) return;

    const content = fs.readFileSync(fullPath, "utf-8");
    const resolved = resolveConflictsMarkdown(content, sourceBranch);
    fs.writeFileSync(fullPath, resolved, "utf-8");
  }

  public getBranchList(pattern?: string): string {
    const cmd = pattern ? `git branch --list '${pattern}'` : "git branch";
    try {
      return this.execCommand(cmd).trim();
    } catch {
      return "No branches found (empty repository).";
    }
  }

  public showCurrentBranch(): string {
    try {
      return this.execCommand("git branch --show-current").trim();
    } catch {
      return "";
    }
  }

  public ensureDraft(): string {
    this.ensureInitialCommit();
    const branchesOutput = this.execCommand("git branch");
    const branches = branchesOutput.split("\n");
    for (let i = 0; i < branches.length; i++) {
      branches[i] = branches[i].trim().replace("* ", "");
    }
    
    if (branches.includes("draft")) {
      this.execCommand("git checkout draft");
      return "Switched to existing 'draft' branch.";
    }
    
    this.execCommand("git checkout -b draft master");
    return "Created and switched to new 'draft' branch from master.";
  }

  public consolidateBranches(): string {
    this.ensureInitialCommit();
    const branches = this.execCommand("git branch")
      .split("\n")
      .map((b) => b.trim().replace("* ", ""))
      .filter((b) => b && b !== "master" && b !== "draft" && !b.startsWith("(HEAD"));

    if (branches.length === 0) {
      return "No branches to consolidate.";
    }

    // Ensure we are on draft branch
    this.ensureDraft();

    let report = "CONSOLIDATION REPORT:\n";
    for (const branch of branches) {
      try {
        this.execCommand(`git merge ${branch} --no-ff -m "Merge legacy branch '${branch}' (Clean)"`);
        report += `- Merged '${branch}' cleanly.\n`;
      } catch {
        // Handle conflicts
        const status = this.execCommand("git status --porcelain");
        const unmerged = status
          .split("\n")
          .filter((line) => line.startsWith("UU "))
          .map((line) => line.slice(3));

        for (const file of unmerged) {
          this.resolveConflictsMarkdownInternal(file, branch);
          this.execCommand(`git add "${file}"`);
        }
        this.execCommand(`git commit -m "Merge branch '${branch}' with accumulative conflict resolution"`);
        report += `- Merged '${branch}' with ${unmerged.length} conflicts preserved in Markdown.\n`;
      }
      this.execCommand(`git branch -D ${branch}`);
    }
    return report;
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

  public commit(message: string, files: string[] | string): string {
    const filesArray = Array.isArray(files) ? files : [files];
    const isolatedItems = this.getIsolatedItems();
    
    // Explicitly block staging of isolated artifacts
    const forbidden = filesArray.filter(f => isolatedItems.includes(f) || isolatedItems.some(i => f.startsWith(i + '/')));
    if (forbidden.length > 0) {
      throw new Error(`Cannot commit isolated artifacts: ${forbidden.join(", ")}. These are protected by the Isolation Protocol.`);
    }

    const filesToStage = filesArray.join(" ");
    this.execCommand(`git add ${filesToStage}`);
    this.execCommand(`git commit -m "${message}"`);
    return `Committed changes with message: ${message}`;
  }

  public finalizeDraft(message: string): string {
    this.execCommand("git checkout master");
    this.execCommand(`git merge draft --no-ff -m "${message}"`);
    this.execCommand("git branch -D draft");
    return "Draft merged into master and deleted. Knowledge base is now in CRYSTALLIZED state.";
  }

  public getStatus(): string {
    return this.execCommand("git status");
  }
}
