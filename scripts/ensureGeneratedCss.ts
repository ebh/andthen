#!/usr/bin/env node
// EAS runs this after `pnpm install`. The root layout imports `tamagui.generated.css`, which only
// `pnpm build` writes and git ignores, so a cloud build has none and Metro fails to resolve the import.
// Native ignores CSS, so an empty file is enough.
import { existsSync, writeFileSync } from "node:fs";

const path = new URL("../tamagui.generated.css", import.meta.url);

if (!existsSync(path)) {
  writeFileSync(path, "");
}
