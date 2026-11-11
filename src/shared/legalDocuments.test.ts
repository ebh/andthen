import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  currentVersion,
  isCurrentPerUserLegalDocument,
  isLegalDocumentId,
  LEGAL_DOCUMENTS,
  legalDocumentPath,
  missingLegalDocumentAcceptances,
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

describe("legalDocumentAcceptanceRequired", () => {
  it.each([
    ["terms-of-service", "per-user"],
    ["copyright-terms/equal-shares", "per-story"],
    ["privacy-policy", "none"],
  ] as const)("%s is accepted %s", (id, expected) => {
    expect(LEGAL_DOCUMENTS[id].legalDocumentAcceptanceRequired).toBe(expected);
  });
});

describe("isLegalDocumentId", () => {
  it.each([
    ["terms-of-service", true],
    ["copyright-terms/equal-shares", true],
    ["unknown", false],
    ["constructor", false],
  ])("%s: %s", (id, expected) => {
    expect(isLegalDocumentId(id)).toBe(expected);
  });
});

describe("isCurrentPerUserLegalDocument", () => {
  it.each([
    ["terms-of-service", 1, true],
    ["terms-of-service", 2, false],
    ["terms-of-service", 0, false],
    ["privacy-policy", 2, false],
    ["copyright-terms/equal-shares", 1, false],
  ] as const)("%s v%d: %s", (id, version, expected) => {
    expect(isCurrentPerUserLegalDocument(id, version)).toBe(expected);
  });
});

describe("missingLegalDocumentAcceptances", () => {
  const registry = {
    "terms-of-service": {
      title: "Terms of service",
      legalDocumentAcceptanceRequired: "per-user",
      versions: [
        { version: 1, effectiveOn: "2026-01-01" },
        { version: 2, effectiveOn: "2026-06-01" },
      ],
    },
    "privacy-policy": {
      title: "Privacy policy",
      legalDocumentAcceptanceRequired: "none",
      versions: [{ version: 1, effectiveOn: "2026-01-01" }],
    },
    "copyright-terms/equal-shares": {
      title: "Copyright terms: equal shares",
      legalDocumentAcceptanceRequired: "per-story",
      versions: [{ version: 1, effectiveOn: "2026-01-01" }],
    },
  } satisfies { [id: string]: LegalDocument };
  const tosV2 = { legalDocumentId: "terms-of-service", version: 2 };

  it("lists the current version of a per-user legal document nobody has accepted", () => {
    expect(missingLegalDocumentAcceptances([], registry)).toEqual([tosV2]);
  });

  it("lists nothing once the current version is held", () => {
    expect(missingLegalDocumentAcceptances([tosV2], registry)).toEqual([]);
  });

  it("lists the current version again when only an older one is held", () => {
    const held = [{ legalDocumentId: "terms-of-service", version: 1 }];

    expect(missingLegalDocumentAcceptances(held, registry)).toEqual([tosV2]);
  });

  it("does not count another legal document's version as held", () => {
    const held = [{ legalDocumentId: "privacy-policy", version: 2 }];

    expect(missingLegalDocumentAcceptances(held, registry)).toEqual([tosV2]);
  });

  it("never lists a per-story or a never-accepted legal document", () => {
    const ids = missingLegalDocumentAcceptances([], registry).map(
      ({ legalDocumentId }) => legalDocumentId,
    );

    expect(ids).toEqual(["terms-of-service"]);
  });

  it("uses the real registry by default", () => {
    expect(missingLegalDocumentAcceptances([])).toEqual([
      { legalDocumentId: "terms-of-service", version: 1 },
    ]);
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
