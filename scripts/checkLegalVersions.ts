#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { findChangedLegalFiles } from "../src/shared/legalVersionCheck.ts";

/**
 * `pnpm legal:check <base>`: fails when a change since `<base>` modified, deleted, renamed or
 * copied a file under `legal/`. A published version is never edited; a change is a new version
 * (`.claude/rules/legal-documents.md`).
 */
const base = process.argv[2];
if (base === undefined) {
  console.error("Usage: pnpm legal:check <base ref>");
  process.exit(2);
}

const nameStatus = execFileSync(
  "git",
  ["diff", "--name-status", `${base}...HEAD`, "--", "legal/"],
  { encoding: "utf8" },
);
const changed = findChangedLegalFiles(nameStatus);

if (changed.length > 0) {
  console.error(
    [
      "A published legal document version must not change:",
      ...changed.map((path) => `  ${path}`),
      "Add a new version instead: a new vN.md beside the old one, and a registry entry in src/shared/legalDocuments.ts.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("Legal document versions unchanged.");
