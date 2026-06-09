import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { 
  validateAndEnforceRules, 
  LibrarianConfig, 
  resolveConflictsMarkdown, 
  classifyStrayFile,
  getStructuralViolations,
  getDuplicateLinks,
  applyTemplateIfNew,
  getMissingIndices,
  generateFolderIndex
} from "./index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs") as any;
  return {
    ...actual,
  };
});

const mockConfig: LibrarianConfig = {
  naming_convention: "^([A-Z][a-z0-9]+_?)+$",
  required_yaml_fields: ["sources"],
  auto_update_date: true,
  main_branch: "master",
  hub_version: 1,
  allowed_text_extensions: [".md", ".txt"],
  language: "en"
};

describe("Librarian Core Logic", () => {
  
  describe("getStructuralViolations", () => {
    it("should return empty list if path does not exist", () => {
      expect(getStructuralViolations("/non/existent")).toEqual([]);
    });

    it("should identify files not in allowed list", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "librarian-test-"));
      fs.writeFileSync(path.join(tempDir, "allowed.md"), "test");
      fs.writeFileSync(path.join(tempDir, "README.md"), "test");
      fs.writeFileSync(path.join(tempDir, "stray.exe"), "test");
      fs.mkdirSync(path.join(tempDir, "wiki"));
      fs.mkdirSync(path.join(tempDir, "stray_dir"));

      const violations = getStructuralViolations(tempDir);
      expect(violations).toContain("allowed.md");
      expect(violations).toContain("stray.exe");
      expect(violations).toContain("stray_dir");
      expect(violations).not.toContain("README.md");
      expect(violations).not.toContain("wiki");

      fs.rmSync(tempDir, { recursive: true });
    });
  });

  describe("getDuplicateLinks", () => {
    it("should return empty if no links found", () => {
      const content = "just some text without links";
      expect(getDuplicateLinks(content)).toEqual([]);
    });

    it("should find duplicate wikilinks", () => {
      const content = "[[Link1]] and [[Link1]] and [[Link2]] and [[Link1|Alias]]";
      const duplicates = getDuplicateLinks(content);
      expect(duplicates).toEqual(["Link1"]);
    });

    it("should return empty if no duplicates", () => {
      const content = "[[Link1]] and [[Link2]]";
      expect(getDuplicateLinks(content)).toEqual([]);
    });
  });

  describe("validateAndEnforceRules", () => {
    it("should reject invalid file naming in wiki", () => {
      const result = validateAndEnforceRules("wiki/bad_name.md", "# Title", mockConfig, "");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Naming violation");
    });

    it("should allow index.md regardless of naming convention if it has required fields", () => {
      const content = "---\nsources: [internal]\n---\n# Index";
      const result = validateAndEnforceRules("wiki/index.md", content, mockConfig, "");
      expect(result.valid).toBe(true);
    });

    it("should skip validation for non-wiki files", () => {
      const result = validateAndEnforceRules("raw/some_file.md", "no header", mockConfig, "");
      expect(result.valid).toBe(true);
    });

    it("should reject missing required YAML fields", () => {
      const content = "---\ntags: [test]\n---\n# Title";
      const result = validateAndEnforceRules("wiki/Valid_Name.md", content, mockConfig, "");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing required YAML field: sources");
    });

    it("should reject missing H1 header", () => {
      const content = "---\nsources: [test]\n---\nNo H1 here";
      const result = validateAndEnforceRules("wiki/Valid_Name.md", content, mockConfig, "");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing H1 header");
    });

    it("should skip H1 check for index.md if it doesn't have one yet (allow generation)", () => {
      const content = "---\nsources: [internal]\n---";
      const result = validateAndEnforceRules("wiki/index.md", content, mockConfig, "");
      expect(result.valid).toBe(true);
    });

    it("should handle decentralized schema if index.md is missing or has no schema", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "librarian-schema-empty-"));
      const wikiDir = path.join(tempDir, "wiki", "Empty");
      fs.mkdirSync(wikiDir, { recursive: true });
      
      const content = "---\nsources: [test]\n---\n# Title";
      const result = validateAndEnforceRules("wiki/Empty/Node.md", content, mockConfig, tempDir);
      expect(result.valid).toBe(true);

      fs.writeFileSync(path.join(wikiDir, "index.md"), "# No YAML here");
      const result2 = validateAndEnforceRules("wiki/Empty/Node.md", content, mockConfig, tempDir);
      expect(result2.valid).toBe(true);

      fs.writeFileSync(path.join(wikiDir, "index.md"), "---\ntags: [test]\n---\n# With YAML but no schema");
      const result3 = validateAndEnforceRules("wiki/Empty/Node.md", content, mockConfig, tempDir);
      expect(result3.valid).toBe(true);

      fs.rmSync(tempDir, { recursive: true });
    });

    it("should return true if required yaml field is not an array (graceful failure)", () => {
      const result = validateAndEnforceRules("wiki/Node.md", "# Title", { ...mockConfig, required_yaml_fields: null as any }, "");
      expect(result.valid).toBe(true); 
    });

    it("should enforce decentralized schema from local index.md", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "librarian-schema-"));
      const wikiDir = path.join(tempDir, "wiki", "Concepts");
      fs.mkdirSync(wikiDir, { recursive: true });
      
      fs.writeFileSync(path.join(wikiDir, "index.md"), "---\nenforce_schema:\n  required_yaml: [domain]\n  required_headers: [\"## Details\", \"## Existing\"]\n---");
      
      const mixedHeader = "---\nsources: [test]\ndomain: dev\n---\n# Title\n## Existing\nSome content";
      const result = validateAndEnforceRules("wiki/Concepts/Node.md", mixedHeader, mockConfig, tempDir);
      expect(result.valid).toBe(true);
      expect(result.content).toContain("## Details");
      expect(result.content).toContain("REQUIRE_HUMAN_INPUT");
      expect(result.content).toContain("## Existing");

      fs.rmSync(tempDir, { recursive: true });
    });

    it("should handle non-array fields in enforce_schema gracefully", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "librarian-schema-bad-fields-"));
      const wikiDir = path.join(tempDir, "wiki", "BadFields");
      fs.mkdirSync(wikiDir, { recursive: true });
      
      fs.writeFileSync(path.join(wikiDir, "index.md"), "---\nenforce_schema:\n  required_yaml: \"not an array\"\n  required_headers: 123\n---");
      
      const content = "---\nsources: [test]\n---\n# Title";
      const result = validateAndEnforceRules("wiki/BadFields/Node.md", content, mockConfig, tempDir);
      expect(result.valid).toBe(true);

      fs.rmSync(tempDir, { recursive: true });
    });

    it("should not update last_updated date if not configured", () => {
      const content = "---\nsources: [test]\nlast_updated: '2020-01-01'\n---\n# Title";
      const result = validateAndEnforceRules("wiki/Valid_Name.md", content, { ...mockConfig, auto_update_date: false } as any, "");
      expect(result.valid).toBe(true);
      expect(result.content).toContain("last_updated: '2020-01-01'");
    });
  });

  describe("applyTemplateIfNew", () => {
    let tempHub: string;

    beforeEach(() => {
      tempHub = fs.mkdtempSync(path.join(os.tmpdir(), "librarian-hub-"));
    });

    afterEach(() => {
      fs.rmSync(tempHub, { recursive: true });
    });

    it("should return incoming content if template file does not exist", () => {
      const relPath = "wiki/New_Node.md";
      const result = applyTemplateIfNew(relPath, "incoming", tempHub);
      expect(result).toBe("incoming");
    });

    it("should return original content if file already exists", () => {
      const relPath = "wiki/Existing.md";
      fs.mkdirSync(path.join(tempHub, "wiki"), { recursive: true });
      fs.writeFileSync(path.join(tempHub, relPath), "original");
      const result = applyTemplateIfNew(relPath, "new", tempHub);
      expect(result).toBe("new");
    });

    it("should return original content if not in wiki/", () => {
      const result = applyTemplateIfNew("raw/New.md", "new", tempHub);
      expect(result).toBe("new");
    });

    it("should apply template and merge metadata for new wiki files", () => {
      const relPath = "wiki/New_Node.md";
      const templatePath = path.join(tempHub, ".librarian", "templates", "Entity_Template.md");
      fs.mkdirSync(path.dirname(templatePath), { recursive: true });
      fs.writeFileSync(templatePath, "---\ntags: [base]\nsources: [base]\n---\n# {{title}}\n## Обзор\nTemplate body");

      const incoming = "---\ntags: [extra]\nsources: [extra]\n---\nIncoming content";
      const result = applyTemplateIfNew(relPath, incoming, tempHub);

      expect(result).toContain("tags:");
      expect(result).toContain("- base");
      expect(result).toContain("- extra");
      expect(result).toContain("# New Node");
      expect(result).toContain("## Обзор\nIncoming content");
    });

    it("should use Project_Template for Projects/ subfolder", () => {
      const relPath = "wiki/Projects/My_Project.md";
      const templatePath = path.join(tempHub, ".librarian", "templates", "Project_Template.md");
      fs.mkdirSync(path.dirname(templatePath), { recursive: true });
      fs.writeFileSync(templatePath, "# Project: {{title}}");

      const result = applyTemplateIfNew(relPath, "# Some content", tempHub);
      expect(result).toContain("# Project: My Project");
    });
  });

  describe("Accumulative Merge (resolveConflictsMarkdown)", () => {
    it("should transform git conflict markers into Markdown callouts", () => {
      const conflictContent = `Some text
<<<<<<< HEAD
Version A text
=======
Version B text
>>>>>>> feature/test
End text`;
      
      const result = resolveConflictsMarkdown(conflictContent, "feature/test");
      
      expect(result).toContain("> [!CAUTION] CONFLICT: Draft vs feature/test");
      expect(result).toContain("> Version A text");
      expect(result).toContain("> Version B text");
      expect(result).toContain("<!-- LIBRARIAN_CONFLICT_START -->");
    });
  });

  describe("Smart Curation (classifyStrayFile)", () => {
    const wikiBaseNames = ["ExistingNode"];
    const allowedExt = [".md", ".txt", ".json"];

    it("should classify empty file with existing name as GHOST", () => {
      const result = classifyStrayFile("ExistingNode.md", "", wikiBaseNames, allowedExt);
      expect(result).toBe("GHOST");
    });

    it("should classify markdown with YAML as NODE", () => {
      const content = "---\ntags: [test]\n---\n# New Node";
      const result = classifyStrayFile("NewNode.md", content, wikiBaseNames, allowedExt);
      expect(result).toBe("NODE");
    });

    it("should classify text file without YAML as SOURCE", () => {
      const result = classifyStrayFile("notes.txt", "just some raw notes", wikiBaseNames, allowedExt);
      expect(result).toBe("SOURCE");
    });

    it("should classify unknown extensions as TRASH", () => {
      const result = classifyStrayFile("image.png", "", wikiBaseNames, allowedExt);
      expect(result).toBe("TRASH");
    });
  });

  describe("Navigation & Indexing", () => {
    const tempHub = path.join(os.tmpdir(), "temp_test_hub_indexing");

    beforeEach(() => {
      if (fs.existsSync(tempHub)) fs.rmSync(tempHub, { recursive: true, force: true });
      fs.mkdirSync(path.join(tempHub, "wiki/ProjectA"), { recursive: true });
      fs.mkdirSync(path.join(tempHub, "wiki/ProjectB"), { recursive: true });
      fs.writeFileSync(path.join(tempHub, "wiki/index.md"), "# Root Index");
      fs.writeFileSync(path.join(tempHub, "wiki/ProjectA/index.md"), "# Project A Index");
    });

    afterEach(() => {
      if (fs.existsSync(tempHub)) fs.rmSync(tempHub, { recursive: true, force: true });
    });

    it("getMissingIndices should return empty if wiki doesn't exist", () => {
      expect(getMissingIndices("/non/existent")).toEqual([]);
    });

    it("getMissingIndices should identify folders without index.md", () => {
      const missing = getMissingIndices(tempHub);
      expect(missing).toContain("wiki/ProjectB");
      expect(missing).not.toContain("wiki/ProjectA");
      expect(missing).not.toContain("wiki");
    });

    it("generateFolderIndex should return compliant markdown", () => {
      const files = [
        { name: "Doc1.md", summary: "Test Doc" },
        { name: "Doc2.md" },
        { name: "index.md" },
        { name: "README.md" }
      ];
      const subfolders = ["SubA"];
      const readme = generateFolderIndex("Test_Folder", files, subfolders);
      
      expect(readme).toContain("# Test Folder");
      expect(readme).toContain("> [!abstract]");
      expect(readme).toContain("## 🗺️ Карта Контента (MOC)");
      expect(readme).toContain("[[Doc1]] — Test Doc");
      expect(readme).toContain("[[Doc2]] — Описание в процессе...");
      expect(readme).not.toContain("[[index]]");
      expect(readme).not.toContain("[[README]]");
      expect(readme).toContain("### 📂 Подразделы");
      expect(readme).toContain("[[SubA/index|SubA]]");
      expect(readme).toContain("```mermaid");
      expect(readme).toContain("[[wiki/index|назад на Главную]]");
    });

    it("generateFolderIndex should handle root wiki folder and empty states", () => {
      const readme = generateFolderIndex("wiki", [], []);
      expect(readme).toContain("# Knowledge Sanctuary");
      expect(readme).toContain("В этой папке пока нет документов.");
      expect(readme).toContain("[[README|назад к Порталу]]");
    });
  });

});