import { marked } from "marked";

import {
  currentVersion,
  isLegalDocumentId,
  LEGAL_DOCUMENTS,
  type LegalDocumentId,
  type LegalDocument,
} from "./legalDocuments.ts";
import { legalPageUrl } from "./legalPageUrl.ts";

export type LegalPage = {
  id: LegalDocumentId;
  version: number;
  /** The output path, relative to `dist`. */
  file: string;
};

/**
 * Every file the build writes: one per version, plus one extra for each document's current
 * version at the address without a version.
 */
export function legalPages(): LegalPage[] {
  const pages: LegalPage[] = [];

  for (const id of legalDocumentIds()) {
    for (const { version } of LEGAL_DOCUMENTS[id].versions) {
      pages.push({ id, version, file: `${fileStem(id)}/v${String(version)}.html` });
    }

    pages.push({ id, version: currentVersion(id).version, file: `${fileStem(id)}.html` });
  }

  return pages;
}

/** A complete HTML page for one version's Markdown text. */
export function renderLegalPage(id: LegalDocumentId, version: number, markdown: string): string {
  const document: LegalDocument = LEGAL_DOCUMENTS[id];
  const title = escapeHtml(`${document.title}, version ${String(version)}`);
  // Markdown is trusted repo content, so there is no sanitiser.
  const body = marked.parse(markdown, { async: false });
  if (typeof body !== "string") {
    throw new TypeError("marked returned a promise for a synchronous parse");
  }

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
<footer>
<h2>All versions</h2>
<ul>
${versionLinks(id, version)}
</ul>
</footer>
</main>
</body>
</html>
`;
}

function versionLinks(id: LegalDocumentId, shown: number): string {
  const current = currentVersion(id).version;

  return LEGAL_DOCUMENTS[id].versions
    .map(({ version, effectiveOn }) => {
      const label = `Version ${String(version)}${version === current ? " (current)" : ""}, effective ${effectiveOn}`;
      return version === shown
        ? `<li>${label} (this page)</li>`
        : `<li><a href="${legalPageUrl(id, version)}">${label}</a></li>`;
    })
    .join("\n");
}

const STYLE = `body{margin:0;background:#f6f1e7;color:#2b2622;font:1.0625rem/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}main{max-width:44rem;margin:0 auto;padding:1.5rem 1rem 3rem}h1,h2,h3{font-family:Georgia,"Times New Roman",serif;line-height:1.25}a{color:#7a3b12}footer{margin-top:3rem;border-top:1px solid #d8cfbd}`;

function fileStem(id: LegalDocumentId): string {
  return `legal/${id}`;
}

function legalDocumentIds(): LegalDocumentId[] {
  return Object.keys(LEGAL_DOCUMENTS).filter(isLegalDocumentId);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
