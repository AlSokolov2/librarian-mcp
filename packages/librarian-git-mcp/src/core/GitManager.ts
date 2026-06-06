import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveConflictsMarkdown } from "@librarian/shared";

interface GitError extends Error {
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

export class GitManager {
  private knowledgePath: string;

  constructor(knowledgePath: string) {
    this.knowledgePath = knowledgePath;
  }

  private execCommand(command: string): string {
    try {
      return execSync(command, { cwd: this.knowledgePath }).toString();
    } catch (error: unknown) {
      const gitError = error as GitError;
      const errorOutput = String(gitError.stdout || gitError.stderr || gitError.message);
      throw new Error(errorOutput, { cause: error });
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
    return this.execCommand(cmd).trim() || "No branches found.";
  }

  public showCurrentBranch(): string {
    return this.execCommand("git branch --show-current").trim();
  }

  public ensureDraft(): string {
    const branches = this.execCommand("git branch")
      .split("\n")
      .map((b) => b.trim().replace("* ", ""));
    if (branches.includes("draft")) {
      this.execCommand("git checkout draft");
      return "Switched to existing 'draft' branch.";
    }
    this.execCommand("git checkout -b draft master");
    return "Created and switched to new 'draft' branch from master.";
  }

  public consolidateBranches(): string {
    const branches = this.execCommand("git branch")
      .split("\n")
      .map((b) => b.trim().replace("* ", ""))
      .filter((b) => b && b !== "master" && b !== "draft" && !b.startsWith("(HEAD"));

    if (branches.length === 0) {
      return "No branches to consolidate.";
    }

    // Ensure we are on draft branch
    const currentBranches = this.execCommand("git branch")
      .split("\n")
      .map((b) => b.trim().replace("* ", ""));
    if (!currentBranches.includes("draft")) {
      this.execCommand("git checkout -b draft master");
    } else {
      this.execCommand("git checkout draft");
    }

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

  public commit(message: string, files: string[] | string): string {
    const filesToStage = Array.isArray(files) ? files.join(" ") : String(files);
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
