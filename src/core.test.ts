import { describe, it, expect } from "vitest";
import { validateAndEnforceRules, LibrarianConfig } from "./core.js";

const mockConfig: LibrarianConfig = {
  naming_convention: "^([A-Z][a-z0-9]+_?)+$",
  required_yaml_fields: ["sources"],
  auto_update_date: true,
  main_branch: "master",
  enable_http_api: false,
  api_port: 3000,
  api_key: "test"
};

describe("Librarian Core Logic", () => {
  
  describe("validateAndEnforceRules", () => {
    
    it("should reject invalid file naming in wiki", () => {
      const result = validateAndEnforceRules("wiki/bad_name.md", "# Title", mockConfig);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Naming violation");
    });

    it("should accept valid file naming in wiki", () => {
      const content = "---\nsources: [test]\n---\n# Valid Title";
      const result = validateAndEnforceRules("wiki/Valid_Name.md", content, mockConfig);
      expect(result.valid).toBe(true);
    });

    it("should reject wiki file without sources", () => {
      const content = "---\ntags: [test]\n---\n# Title";
      const result = validateAndEnforceRules("wiki/Test.md", content, mockConfig);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing required YAML field: sources");
    });

    it("should reject wiki file without H1 header", () => {
      const content = "---\nsources: [test]\n---\nJust some text";
      const result = validateAndEnforceRules("wiki/Test.md", content, mockConfig);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing H1 header");
    });

    it("should automatically update last_updated date", () => {
      const content = "---\nsources: [test]\nlast_updated: 2000-01-01\n---\n# Title";
      const result = validateAndEnforceRules("wiki/Test.md", content, mockConfig);
      const today = new Date().toISOString().split('T')[0];
      // Use regex to allow optional quotes from YAML stringifier
      expect(result.content).toMatch(new RegExp(`last_updated: ['"]?${today}['"]?`));
    });

    it("should bypass rules for non-wiki files", () => {
      const result = validateAndEnforceRules("raw/any_name.txt", "raw content", mockConfig);
      expect(result.valid).toBe(true);
    });

  });
});
