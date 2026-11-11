import type { LegalDocumentId } from "./legalDocuments.ts";

/**
 * Where legal pages are served. There is no page at `/legal` itself, because `legal` is a valid
 * story ID. Kept apart from `legalPages.ts` so the service worker can import it without bundling
 * the Markdown renderer.
 */
export const LEGAL_PAGE_PREFIX = "/legal/";

/** The address of a document's current version, or of one version when `version` is given. */
export function legalPageUrl(id: LegalDocumentId, version?: number): string {
  return version === undefined
    ? `${LEGAL_PAGE_PREFIX}${id}`
    : `${LEGAL_PAGE_PREFIX}${id}/v${String(version)}`;
}
