export type LegalVersion = {
  version: number;
  /** The day the version takes effect, as `YYYY-MM-DD`. */
  effectiveOn: string;
};

/**
 * How often a person gives a legal document acceptance for a legal document: once per user, once
 * per story, or never because the legal document is only shown.
 */
export type LegalDocumentAcceptanceRequired = "per-user" | "per-story" | "none";

export type LegalDocument = {
  title: string;
  legalDocumentAcceptanceRequired: LegalDocumentAcceptanceRequired;
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
    legalDocumentAcceptanceRequired: "per-user",
    versions: [{ version: 1, effectiveOn: "2026-11-09" }],
  },
  "privacy-policy": {
    title: "Privacy policy",
    legalDocumentAcceptanceRequired: "none",
    versions: [
      { version: 1, effectiveOn: "2026-11-09" },
      { version: 2, effectiveOn: "2026-11-17" },
      { version: 3, effectiveOn: "2026-11-18" },
      { version: 4, effectiveOn: "2026-11-18" },
    ],
  },
  "copyright-terms/equal-shares": {
    title: "Copyright terms: equal shares",
    legalDocumentAcceptanceRequired: "per-story",
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

export function isLegalDocumentId(id: string): id is LegalDocumentId {
  return Object.hasOwn(LEGAL_DOCUMENTS, id);
}

/** One version of one legal document. */
export type LegalDocumentVersion = {
  legalDocumentId: string;
  version: number;
};

/**
 * The current version of every legal document that is accepted per user and that
 * `legalDocumentAcceptances` does not hold. A story's copyright terms are never listed, because
 * they are accepted per story. Pass only the user's per-user rows: a row tied to a story proves
 * nothing here.
 */
export function missingLegalDocumentAcceptances(
  legalDocumentAcceptances: readonly LegalDocumentVersion[],
  registry: { [id: string]: LegalDocument } = LEGAL_DOCUMENTS,
): LegalDocumentVersion[] {
  const missing: LegalDocumentVersion[] = [];

  for (const [legalDocumentId, document] of Object.entries(registry)) {
    const current = document.versions.at(-1);
    if (document.legalDocumentAcceptanceRequired !== "per-user" || current === undefined) {
      continue;
    }

    const isHeld = legalDocumentAcceptances.some(
      (held) => held.legalDocumentId === legalDocumentId && held.version === current.version,
    );
    if (!isHeld) {
      missing.push({ legalDocumentId, version: current.version });
    }
  }

  return missing;
}

/**
 * Whether a legal document acceptance with no story can be given for this version: the legal
 * document is accepted per user and `version` is its current one. An older version can't be
 * accepted, because the person would be agreeing to a text that no longer applies.
 */
export function isCurrentPerUserLegalDocument(id: LegalDocumentId, version: number): boolean {
  return (
    LEGAL_DOCUMENTS[id].legalDocumentAcceptanceRequired === "per-user" &&
    currentVersion(id).version === version
  );
}
