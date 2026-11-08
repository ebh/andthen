---
paths:
  - "legal/**"
  - "src/shared/legalDocuments.ts"
---

# Legal document rules

The texts people accept live in `legal/`; `src/shared/legalDocuments.ts` registers them. `docs/domain.md` ("Legal documents") defines the words.

- **Never edit a merged version.** People accept a specific version, and an edit changes what they accepted. CI runs `pnpm legal:check` and fails a pull request that modifies, deletes or renames a file under `legal/`.
- **A change is a new file beside the old one, plus a registry entry.** Add `vN+1.md` and its `{ version, effectiveOn }` in `LEGAL_DOCUMENTS`. `legalDocuments.test.ts` fails when a file and an entry disagree.
- **A new copyright model is a new folder under `legal/copyright-terms/`**, not a new version. A story picks a model, so changing what a model means would change the deal for stories that already picked it.
- **Ask the owner before raising the version of a document people have accepted.** A new version makes everyone accept again (#72), which is a cost the owner decides.
- **Keep the operator (andthen.page), contact (`support@andthen.page`), minimum age (16) and governing law (Victoria, Australia) the same in every document.** A reader treats the three texts as one agreement, and a mismatch reads as a contradiction.
- **Use only words from `docs/domain.md`, plus "passage author" and "copyright model".** The texts are read against the app, so a different word reads as a different thing. Never use a word from its Reserved section.
- **Write plain Australian English.** The readers are not lawyers.
- **Keep the repo public-safe.** No personal names, personal email addresses or local paths.
