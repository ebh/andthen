---
paths:
  - "assets/**"
  - "public/**"
  - "scripts/icons.ts"
  - "scripts/renderIcons.ts"
  - "app.json"
---

# Asset rules

These apply when you add, change or move an image, icon, font or other static file. `docs/assets.md` holds the layout, the size rules and where each future kind of file goes. Read it first.

- **Hand-made art goes in `assets/brand/` and nowhere else.** Every icon, splash and favicon size is made from it.
- **Never edit a generated file.** `assets/generated/` and the icons in `public/` are made by `scripts/renderIcons.ts` on `pnpm install` and are not in git. Change the source, then run `pnpm icons`.
- **A new icon size or output is one line in `PNG_OUTPUTS`** (`scripts/icons.ts`), plus the config that names it. `scripts/icons.test.ts` fails when `app.json`, `public/manifest.json` or `public/index.html` names an icon the script does not make.
- **An image that one screen shows sits beside its component in `src/ui/`**, and the component imports it.
- **`public/` holds only what is served unchanged at a fixed address**: `index.html`, `manifest.json` and similar hand-written files, plus the generated icons.
- **A third-party image or font records its licence in `docs/assets.md`.** The repo is public.
