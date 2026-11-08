#!/usr/bin/env node
// `pnpm install` runs this (the `postinstall` script), so a fresh clone, CI and EAS all get the icons.
// The generated files are not in git: change `assets/brand/icon-foreground.svg` and run `pnpm icons`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initWasm } from "@resvg/resvg-wasm";
import {
  FAVICON_PATH,
  FAVICON_SIZE,
  PNG_OUTPUTS,
  SVG_ICON_PATH,
  icoFromPng,
  opaquePng,
  rasterise,
  withBackground,
} from "./icons.ts";

await initWasm(readFileSync(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))));

const foreground = readFileSync(repoFile("assets/brand/icon-foreground.svg"), "utf8");
const withColour = withBackground(foreground);

for (const { path, size, background } of PNG_OUTPUTS) {
  write(
    path,
    background ? opaquePng(rasterise(withColour, size)) : rasterise(foreground, size).png,
  );
}
write(SVG_ICON_PATH, withColour);
write(FAVICON_PATH, icoFromPng(rasterise(withColour, FAVICON_SIZE).png, FAVICON_SIZE));

function write(path: string, contents: string | Uint8Array): void {
  const file = repoFile(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function repoFile(path: string): string {
  return fileURLToPath(new URL(`../${path}`, import.meta.url));
}
