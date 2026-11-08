import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  currentVersion,
  LEGAL_DOCUMENTS,
  legalDocumentPath,
  type LegalDocument,
  type LegalDocumentId,
} from "./legalDocuments";

// Resolved from this file, not the working directory, so Vitest and Stryker's sandbox agree.
const REPO_ROOT = `${resolve(import.meta.dirname, "../..")}/`;

const documents: { id: LegalDocumentId; document: LegalDocument }[] = [];
for (const id of Object.keys(LEGAL_DOCUMENTS)) {
  if (isLegalDocumentId(id)) {
    documents.push({ id, document: LEGAL_DOCUMENTS[id] });
  }
}

const versionRows = documents.flatMap(({ id, document }) =>
  document.versions.map((entry) => ({ id, title: document.title, ...entry })),
);

describe("legalDocumentPath and currentVersion", () => {
  it("puts a version's text at legal/<id>/v<n>.md", () => {
    expect(legalDocumentPath("copyright-terms/equal-shares", 3)).toBe(
      "legal/copyright-terms/equal-shares/v3.md",
    );
  });

  it.each(documents)("$id: the current version is the last one", ({ id, document }) => {
    expect(currentVersion(id)).toBe(document.versions.at(-1));
  });
});

describe("the registry", () => {
  it.each(documents)("$id: versions run 1..n without gaps", ({ document }) => {
    expect(document.versions.map(({ version }) => version)).toEqual(
      document.versions.map((_, index) => index + 1),
    );
  });

  it.each(versionRows)("$id v$version: takes effect on a calendar date", ({ effectiveOn }) => {
    expect(effectiveOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${effectiveOn}T00:00:00Z`).toISOString().slice(0, 10)).toBe(effectiveOn);
  });
});

describe("the legal/ folder", () => {
  it("holds exactly the registered files", () => {
    const registered = versionRows
      .map(({ id, version }) => legalDocumentPath(id, version))
      .toSorted();

    expect(filesUnderLegal()).toEqual(registered);
  });

  it.each(versionRows)("$id v$version: has a file", ({ id, version }) => {
    expect(existsSync(REPO_ROOT + legalDocumentPath(id, version))).toBe(true);
  });

  it.each(versionRows)("$id v$version: is headed by its title and version", (row) => {
    const lines = readText(legalDocumentPath(row.id, row.version)).split("\n");

    expect(lines[0]).toBe(`# ${row.title}`);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe(`Version ${String(row.version)} · Effective ${row.effectiveOn}`);
  });

  it.each(versionRows)("$id v$version: gives the support address", ({ id, version }) => {
    expect(readText(legalDocumentPath(id, version))).toContain("support@andthen.page");
  });
});

function filesUnderLegal(): string[] {
  return readdirSync(`${REPO_ROOT}legal`, { recursive: true, encoding: "utf8" })
    .filter((path) => statSync(`${REPO_ROOT}legal/${path}`).isFile())
    .map((path) => `legal/${path.replaceAll("\\", "/")}`)
    .toSorted();
}

function readText(path: string): string {
  return readFileSync(REPO_ROOT + path, "utf8");
}

function isLegalDocumentId(id: string): id is LegalDocumentId {
  return id in LEGAL_DOCUMENTS;
}
