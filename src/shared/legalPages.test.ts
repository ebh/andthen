import { describe, expect, it } from "vitest";

import { LEGAL_DOCUMENTS } from "./legalDocuments";
import { legalPages, renderLegalPage } from "./legalPages";

describe("legalPages", () => {
  const pages = legalPages();
  const files = pages.map((page) => page.file);

  // Pins one file per version plus one current page per document: 5 versions and 3 current pages.
  it("lists every version and one current page per document", () => {
    expect(files).toHaveLength(8);
    expect(files).toEqual(
      expect.arrayContaining([
        "legal/terms-of-service/v1.html",
        "legal/terms-of-service.html",
        "legal/privacy-policy/v1.html",
        "legal/privacy-policy/v2.html",
        "legal/privacy-policy/v3.html",
        "legal/privacy-policy.html",
        "legal/copyright-terms/equal-shares/v1.html",
        "legal/copyright-terms/equal-shares.html",
      ]),
    );
  });

  it("has no duplicate files", () => {
    expect(new Set(files).size).toBe(files.length);
  });

  it("builds the current page from the newest version", () => {
    expect(pages.find((page) => page.file === "legal/privacy-policy.html")).toEqual({
      id: "privacy-policy",
      version: 3,
      file: "legal/privacy-policy.html",
    });
  });
});

describe("renderLegalPage", () => {
  const page = renderLegalPage("privacy-policy", 2, "# Privacy policy\n\nVersion 2");

  it("is a complete English (Australia) HTML document", () => {
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain('<html lang="en-AU">');
    expect(page).toContain('<meta charset="utf-8">');
    expect(page).toContain('name="viewport"');
  });

  it("titles the page with the document title and the version", () => {
    expect(page).toContain("<title>Privacy policy, version 2</title>");
  });

  it("renders the Markdown", () => {
    expect(page).toContain("<h1>Privacy policy</h1>");
  });

  // Pins that the page shown is plain text and every other version links to its own address.
  it("lists every version, linking all but the one shown", () => {
    expect(page).toContain(
      '<li><a href="/legal/privacy-policy/v1">Version 1, effective 2026-11-09</a></li>',
    );
    expect(page).toContain("<li>Version 2, effective 2026-11-17 (this page)</li>");
    expect(page).toContain(
      '<li><a href="/legal/privacy-policy/v3">Version 3 (current), effective 2026-11-18</a></li>',
    );
  });

  it("marks the current version when it is the page shown", () => {
    expect(renderLegalPage("privacy-policy", 3, "# x")).toContain(
      "<li>Version 3 (current), effective 2026-11-18 (this page)</li>",
    );
  });

  it("loads nothing from outside", () => {
    expect(page).not.toContain("http://");
    expect(page).not.toContain("https://");
    expect(page).not.toContain("<script");
  });

  // Titles come from the registry, but escaping stops a title with markup from breaking the page.
  it("escapes the title", () => {
    const document = LEGAL_DOCUMENTS["terms-of-service"];
    const original = document.title;
    Object.defineProperty(document, "title", { value: `A & <b> "q"`, configurable: true });

    try {
      expect(renderLegalPage("terms-of-service", 1, "x")).toContain(
        "<title>A &amp; &lt;b&gt; &quot;q&quot;, version 1</title>",
      );
    } finally {
      Object.defineProperty(document, "title", { value: original, configurable: true });
    }
  });
});
