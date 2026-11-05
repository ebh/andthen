#!/usr/bin/env node
import { stat } from "node:fs/promises";

import { getManifest } from "@serwist/build";
import { build } from "esbuild";

/**
 * Bundles `src/serviceWorker/sw.ts` into `dist/sw.js`, with the list of files to precache filled in.
 * Runs after `expo export` as part of `pnpm build`.
 *
 * The bundle is a classic script (`iife`), not a module: Firefox before 147 can't register a module
 * service worker. The build fails if `dist/sw.js` is not there afterwards, because Cloudflare's
 * single-page fallback would answer `/sw.js` with `index.html` and a 200, and browsers would then
 * reject the registration only on the user's device.
 */

const DIST = "dist";
const SW_PATH = `${DIST}/sw.js`;

const precache = await getManifest({
  globDirectory: DIST,
  // The hashed app shell: the page, its scripts and styles, and the fonts, plus the two tab icons that
  // every page links to. Left out on purpose: the larger manifest and touch icons (only the install
  // flow fetches them, and that needs the network anyway), the expo-router images under
  // `assets/node_modules` (the app uses none of them) and `metadata.json`.
  // Expo keeps the fonts under pnpm's `.pnpm` folder, which `**` skips because its name starts with a
  // dot, so the pattern names it.
  globPatterns: [
    "index.html",
    "icon.svg",
    "favicon.ico",
    "_expo/static/**/*",
    "assets/node_modules/.pnpm/**/*.ttf",
  ],
  // The default ignores `node_modules`, where those fonts are.
  globIgnores: [],
  modifyURLPrefix: { "": "/" },
  // Expo puts a content hash in these names, so the URL already changes with the content.
  dontCacheBustURLsMatching: /[-.][0-9a-f]{32}\./,
});

const { manifestEntries } = precache;
if (manifestEntries === undefined) {
  throw new Error(`No precache list was built: ${precache.warnings.join("; ")}`);
}

const precached = manifestEntries.map((entry) => entry.url);
const hasAppShell =
  precached.includes("/index.html") &&
  precached.includes("/icon.svg") &&
  precached.some((url) => url.startsWith("/_expo/")) &&
  precached.some((url) => url.endsWith(".ttf"));
if (!hasAppShell) {
  throw new Error(`The precache list is missing the app shell: ${precached.join(", ")}`);
}

await build({
  entryPoints: ["src/serviceWorker/sw.ts"],
  outfile: SW_PATH,
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  define: { PRECACHE_ENTRIES: JSON.stringify(manifestEntries) },
  logLevel: "warning",
});

if ((await stat(SW_PATH)).size === 0) {
  throw new Error(`${SW_PATH} is empty`);
}
console.log(`${SW_PATH}: precaching ${precached.length.toString()} files`);
