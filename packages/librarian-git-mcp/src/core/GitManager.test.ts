import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GitManager } from "./GitManager.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("GitManager Cold Start", () => {
  let tempHubPath: string;

  beforeEach(() => {
    tempHubPath = path.join(os.tmpdir(), `librarian-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    fs.mkdirSync(tempHubPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempHubPath, { recursive: true, force: true });
  });

  it("should initialize and perform cold start on empty directory", () => {
    const gitManager = new GitManager(tempHubPath);
    
    // ensureDraft should trigger cold start
    const result = gitManager.ensureDraft();
    
    expect(result).toContain("Created and switched to new 'draft' branch from master");
    expect(fs.existsSync(path.join(tempHubPath, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(tempHubPath, ".librarian", "INSTRUCTIONS.md"))).toBe(true);
    
    const currentBranch = gitManager.showCurrentBranch();
    expect(currentBranch).toBe("draft");
    
    const branches = gitManager.getBranchList();
    expect(branches).toContain("master");
    expect(branches).toContain("draft");
  });

  it("should provide useful error messages from git commands", () => {
    const gitManager = new GitManager(tempHubPath);
    
    expect(() => {
      gitManager.getStatus();
    }).toThrow(/Git command failed: git status/);
  });

  it("should block commit of isolated artifacts", () => {
    const gitManager = new GitManager(tempHubPath);
    gitManager.ensureDraft();
    
    // Create an isolated artifact
    fs.writeFileSync(path.join(tempHubPath, ".gemini"), "test data");
    const gitignorePath = path.join(tempHubPath, ".gitignore");
    fs.writeFileSync(gitignorePath, "\n# LIBRARIAN ISOLATED ARTIFACTS\n.gemini\n");

    expect(() => {
      gitManager.commit("test", [".gemini"]);
    }).toThrow(/Cannot commit isolated artifacts: \.gemini/);
    
    expect(() => {
      gitManager.commit("test", ".gemini/config.json");
    }).toThrow(/Cannot commit isolated artifacts: \.gemini\/config\.json/);
  });
});
