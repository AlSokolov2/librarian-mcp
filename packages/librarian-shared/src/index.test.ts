import { describe, it, expect } from "vitest";
import { validateAndEnforceRules, LibrarianConfig, resolveConflictsMarkdown, classifyStrayFile } from "./index.js";

const mockConfig: LibrarianConfig = {
  naming_convention: "^([A-Z][a-z0-9]+_?)+$",
  required_yaml_fields: ["sources"],
  auto_update_date: true,
  main_branch: "master",
  hub_version: 1,
  allowed_text_extensions: [".md", ".txt"]
};

describe("Librarian Core Logic", () => {
  
  describe("validateAndEnforceRules", () => {
    // ... (existing tests remain valid)
    it("should reject invalid file naming in wiki", () => {
      const result = validateAndEnforceRules("wiki/bad_name.md", "# Title", mockConfig);
      expect(result.valid).toBe(false);
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

});
