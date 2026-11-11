#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { legalDocumentPath } from "../src/shared/legalDocuments.ts";
import { legalPages, renderLegalPage, type LegalPage } from "../src/shared/legalPages.ts";

/**
 * Turns every legal document's Markdown into a static HTML page under `dist/legal/`. Runs after
 * `expo export` as part of `pnpm build`.
 *
 * The build fails if an expected page is missing or empty, because Cloudflare's single-page
 * fallback would answer a missing page with `index.html` and a 200.
 */

const DIST = "dist";

const pages = legalPages();

await Promise.all(pages.map(writePage));
await Promise.all(pages.map(expectNotEmpty));
console.log(`${DIST}/legal: wrote ${pages.length.toString()} pages`);

async function writePage({ id, version, file }: LegalPage): Promise<void> {
  const markdown = await readFile(legalDocumentPath(id, version), "utf8");
  const output = `${DIST}/${file}`;

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderLegalPage(id, version, markdown));
}

async function expectNotEmpty({ file }: LegalPage): Promise<void> {
  if ((await stat(`${DIST}/${file}`)).size === 0) {
    throw new Error(`${DIST}/${file} is empty`);
  }
}
