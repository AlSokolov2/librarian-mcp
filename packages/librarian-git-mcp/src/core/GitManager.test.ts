import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GitManager } from "./GitManager.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// We need to mock child_process for specific error handling tests
vi.mock("child_process", async () => {
  const actual = await vi.importActual("child_process") as Record<string, (...args: unknown[]) => unknown>;
  return {
    ...actual,
    execSync: vi.fn().mockImplementation((cmd: string, opts: unknown) => {
      if (cmd === "TRIGGER_EMPTY_ERROR") {
        throw {};
      }
      if (cmd === "git branch --show-current" && (opts as { cwd?: string })?.cwd?.includes("TRIGGER_SHOW_CURRENT_ERROR")) {
        throw new Error("fail");
      }
      if (cmd.startsWith("git config user.") && (opts as { cwd?: string })?.cwd?.includes("TRIGGER_CONFIG_ERROR")) {
        throw new Error("config fail");
      }
      return actual.execSync(cmd, opts);
    }),
  };
});

describe("GitManager", () => {
  let tempHubPath: string;

  beforeEach(() => {
    tempHubPath = fs.mkdtempSync(path.join(os.tmpdir(), `librarian-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`));
  });

  afterEach(() => {
    fs.rmSync(tempHubPath, { recursive: true, force: true });
  });

  function getPrivateMethod(manager: GitManager, name: string): (...args: unknown[]) => unknown {
    return (manager as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
  }

  describe("execCommand", () => {
    it("should throw a descriptive error when git fails", () => {
      const gitManager = new GitManager(tempHubPath);
      const exec = getPrivateMethod(gitManager, "execCommand");
      expect(() => exec.call(gitManager, "git status")).toThrow(/Git command failed: git status/);
    });

    it("should handle error without stderr/stdout/message", () => {
      const gitManager = new GitManager(tempHubPath);
      const exec = getPrivateMethod(gitManager, "execCommand");
      expect(() => exec.call(gitManager, "TRIGGER_EMPTY_ERROR")).toThrow(/Unknown error/);
    });
  });

  describe("ensureInitialCommit (Cold Start)", () => {
    it("should initialize and perform cold start on empty directory", () => {
      const gitManager = new GitManager(tempHubPath);
      // This should trigger the full cold start catch block
      gitManager.ensureDraft();
      
      expect(fs.existsSync(path.join(tempHubPath, ".git"))).toBe(true);
      expect(fs.existsSync(path.join(tempHubPath, ".librarian", "INSTRUCTIONS.md"))).toBe(true);
      expect(gitManager.showCurrentBranch()).toBe("draft");
      expect(gitManager.getBranchList()).toContain("master");
    });

    it("should skip template creation if files already exist during cold start", () => {
      const libDir = path.join(tempHubPath, ".librarian");
      fs.mkdirSync(libDir, { recursive: true });
      fs.writeFileSync(path.join(libDir, "INSTRUCTIONS.md"), "already here");
      
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      
      expect(fs.readFileSync(path.join(libDir, "INSTRUCTIONS.md"), "utf-8")).toBe("already here");
    });

    it("should handle config errors gracefully during cold start", () => {
      const triggerPath = path.join(tempHubPath, "TRIGGER_CONFIG_ERROR");
      fs.mkdirSync(triggerPath);
      
      const gitManager = new GitManager(triggerPath);
      // Should not throw even if git config fails
      expect(() => gitManager.ensureDraft()).not.toThrow();
    });

    it("should rename branch to master if it is something else (main)", () => {
      const gitManager = new GitManager(tempHubPath);
      const exec = getPrivateMethod(gitManager, "execCommand");
      exec.call(gitManager, "git init -b main");
      fs.writeFileSync(path.join(tempHubPath, "init.txt"), "init");
      exec.call(gitManager, "git add init.txt");
      exec.call(gitManager, "git commit -m 'init'");
      
      gitManager.ensureDraft();
      expect(gitManager.getBranchList()).toContain("master");
    });
  });

  describe("ensureDraft", () => {
    it("should switch to existing draft branch", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft(); // Create
      gitManager.finalizeDraft("merge"); // Back to master
      gitManager.ensureDraft(); // Create again
      const result = gitManager.ensureDraft(); // Switch to existing
      expect(result).toBe("Switched to existing 'draft' branch.");
    });
  });

  describe("finalizeDraft", () => {
    it("should merge draft into master and delete draft", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      fs.writeFileSync(path.join(tempHubPath, "test.txt"), "hello");
      gitManager.commit("feat: test", "test.txt");
      const result = gitManager.finalizeDraft("merge message");
      expect(result).toContain("Draft merged into master and deleted");
      expect(gitManager.showCurrentBranch()).toBe("master");
    });

    it("should return early if conflict file does not exist (internal)", () => {
      const gitManager = new GitManager(tempHubPath);
      const method = getPrivateMethod(gitManager, "resolveConflictsMarkdownInternal");
      expect(method.call(gitManager, "ghost.md", "master")).toBeUndefined();
    });
  });

  describe("consolidateBranches", () => {
    it("should return early if no branches to consolidate", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      const result = gitManager.consolidateBranches();
      expect(result).toBe("No branches to consolidate.");
    });

    it("should merge cleanly when no conflicts", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      gitManager.finalizeDraft("init");
      const exec = getPrivateMethod(gitManager, "execCommand");
      exec.call(gitManager, "git checkout -b feature/clean master");
      fs.writeFileSync(path.join(tempHubPath, "clean.txt"), "clean");
      gitManager.commit("feat: clean", "clean.txt");
      exec.call(gitManager, "git checkout master");
      const result = gitManager.consolidateBranches();
      expect(result).toContain("- Merged 'feature/clean' cleanly.");
      expect(gitManager.showCurrentBranch()).toBe("draft");
    });

    it("should merge with accumulative conflict resolution", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      fs.writeFileSync(path.join(tempHubPath, "conflict.txt"), "version master");
      gitManager.commit("feat: init conflict", "conflict.txt");
      gitManager.finalizeDraft("init");
      const exec = getPrivateMethod(gitManager, "execCommand");
      exec.call(gitManager, "git checkout -b feature/conflict master");
      fs.writeFileSync(path.join(tempHubPath, "conflict.txt"), "version feature");
      gitManager.commit("feat: feature conflict", "conflict.txt");
      exec.call(gitManager, "git checkout master");
      gitManager.ensureDraft();
      fs.writeFileSync(path.join(tempHubPath, "conflict.txt"), "version draft");
      gitManager.commit("feat: draft conflict", "conflict.txt");
      const result = gitManager.consolidateBranches();
      expect(result).toContain("- Merged 'feature/conflict' with 1 conflicts preserved in Markdown.");
      const content = fs.readFileSync(path.join(tempHubPath, "conflict.txt"), "utf-8");
      expect(content).toContain("> [!CAUTION] CONFLICT: Draft vs feature/conflict");
    });
  });

  describe("Branch Utilities", () => {
    it("should support pattern matching in branch list", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      const exec = getPrivateMethod(gitManager, "execCommand");
      exec.call(gitManager, "git checkout -b feature/1 master");
      const list = gitManager.getBranchList("feature/*");
      expect(list).toContain("feature/1");
    });

    it("should return status", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      expect(gitManager.getStatus()).toContain("On branch draft");
    });

    it("should handle error in showCurrentBranch", () => {
      const gitManager = new GitManager(path.join(tempHubPath, "TRIGGER_SHOW_CURRENT_ERROR"));
      fs.mkdirSync(path.join(tempHubPath, "TRIGGER_SHOW_CURRENT_ERROR"));
      expect(gitManager.showCurrentBranch()).toBe("");
    });
  });

  describe("Isolation Protocol", () => {
    it("should return empty list if .gitignore does not exist", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      fs.writeFileSync(path.join(tempHubPath, "file.txt"), "test");
      expect(() => gitManager.commit("msg", "file.txt")).not.toThrow();
    });

    it("should return empty list if section header is missing", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      fs.writeFileSync(path.join(tempHubPath, "file.txt"), "test");
      fs.writeFileSync(path.join(tempHubPath, ".gitignore"), "node_modules\n");
      expect(() => gitManager.commit("msg", "file.txt")).not.toThrow();
    });

    it("should block commit of isolated artifacts", () => {
      const gitManager = new GitManager(tempHubPath);
      gitManager.ensureDraft();
      fs.writeFileSync(path.join(tempHubPath, ".gemini"), "test data");
      fs.writeFileSync(path.join(tempHubPath, ".gitignore"), "\n# LIBRARIAN ISOLATED ARTIFACTS\n.gemini\n");
      expect(() => gitManager.commit("test", [".gemini"])).toThrow(/Cannot commit isolated artifacts/);
      expect(() => gitManager.commit("test", [".gemini/config.json"])).toThrow(/Cannot commit isolated artifacts/);
    });
  });

  describe("Helper methods", () => {
    it("should handle error in getBranchList when repo empty", () => {
      const gitManager = new GitManager(tempHubPath);
      fs.mkdirSync(path.join(tempHubPath, ".git"));
      expect(gitManager.getBranchList()).toBe("No branches found (empty repository).");
    });
  });
});
