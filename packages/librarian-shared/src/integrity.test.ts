import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getStructuralViolations, ALLOWED_ROOT_DIRS, ALLOWED_ROOT_FILES, getDuplicateLinks } from "./index.js";

describe("Librarian Structural Integrity", () => {
  let tempHub: string;

  beforeEach(() => {
    tempHub = fs.mkdtempSync(path.join(os.tmpdir(), "librarian-test-"));
    // Create valid structure
    ALLOWED_ROOT_DIRS.forEach(d => fs.mkdirSync(path.join(tempHub, d)));
    ALLOWED_ROOT_FILES.forEach(f => fs.writeFileSync(path.join(tempHub, f), "content"));
  });

  afterEach(() => {
    fs.rmSync(tempHub, { recursive: true, force: true });
  });

  it("should return empty list for a perfect Hub", () => {
    const violations = getStructuralViolations(tempHub);
    expect(violations).toHaveLength(0);
  });

  it("should detect unauthorized directories", () => {
    fs.mkdirSync(path.join(tempHub, "scripts"));
    fs.mkdirSync(path.join(tempHub, "meta"));
    const violations = getStructuralViolations(tempHub);
    expect(violations).toContain("scripts");
    expect(violations).toContain("meta");
  });

  it("should detect unauthorized files", () => {
    fs.writeFileSync(path.join(tempHub, "evil.exe"), "virus");
    fs.writeFileSync(path.join(tempHub, "package.json"), "{}");
    const violations = getStructuralViolations(tempHub);
    expect(violations).toContain("evil.exe");
    expect(violations).toContain("package.json");
  });

  it("should not touch wiki/ content (only checks root)", () => {
    fs.writeFileSync(path.join(tempHub, "wiki", "any_file.txt"), "ok");
    const violations = getStructuralViolations(tempHub);
    expect(violations).toHaveLength(0);
  });
});

describe("Librarian Content Neatness", () => {
  it("should detect duplicate wiki-links", () => {
    const content = "Link to [[Topic]] and again [[Topic]]. Also [[Other]].";
    const duplicates = getDuplicateLinks(content);
    expect(duplicates).toContain("Topic");
    expect(duplicates).not.toContain("Other");
  });

  it("should detect duplicates even with aliases", () => {
    const content = "[[Topic|Alias]] and [[Topic]].";
    const duplicates = getDuplicateLinks(content);
    expect(duplicates).toContain("Topic");
  });

  it("should return empty list if no duplicates", () => {
    const content = "[[Topic1]], [[Topic2]], [[Topic3]]";
    const duplicates = getDuplicateLinks(content);
    expect(duplicates).toHaveLength(0);
  });
});
