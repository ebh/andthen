export type LegalVersion = {
  version: number;
  /** The day the version takes effect, as `YYYY-MM-DD`. */
  effectiveOn: string;
};

export type LegalDocument = {
  title: string;
  /** Oldest first, numbered 1..n. */
  versions: readonly LegalVersion[];
};

export type LegalDocumentId = keyof typeof LEGAL_DOCUMENTS;

/**
 * Every legal document and its versions. A version's text is `legalDocumentPath(id, version)`.
 * A merged version is never edited: a change is a new file and a new entry here
 * (`.claude/rules/legal-documents.md`). A copyright model is one folder under `copyright-terms/`.
 */
export const LEGAL_DOCUMENTS = {
  "terms-of-service": {
    title: "Terms of service",
    versions: [{ version: 1, effectiveOn: "2026-11-09" }],
  },
  "privacy-policy": {
    title: "Privacy policy",
    versions: [
      { version: 1, effectiveOn: "2026-11-09" },
      { version: 2, effectiveOn: "2026-11-17" },
      { version: 3, effectiveOn: "2026-11-17" },
    ],
  },
  "copyright-terms/equal-shares": {
    title: "Copyright terms: equal shares",
    versions: [{ version: 1, effectiveOn: "2026-11-09" }],
  },
} satisfies { [id: string]: LegalDocument };

/** The newest version of a document. */
export function currentVersion(id: LegalDocumentId): LegalVersion {
  const latest = LEGAL_DOCUMENTS[id].versions.at(-1);
  if (latest === undefined) {
    throw new Error(`Legal document ${id} has no versions`);
  }

  return latest;
}

/** The repo path of one version's Markdown text. */
export function legalDocumentPath(id: LegalDocumentId, version: number): string {
  return `legal/${id}/v${String(version)}.md`;
}
