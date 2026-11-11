# Constraints

What the tools and platforms force on the code, each with the file that carries it. Facts owned by another doc are linked, not repeated. Versions live in `package.json`.

## Tests and Stryker

- **Integration tests get bindings from `getPlatformProxy`** (`test/support/testEnv.ts`), with every migration applied to an in-memory D1. Use it, not `new Miniflare()`: the Miniflare in wrangler's dependencies changed its options shape.
- **`getPlatformProxy` cannot run a Durable Object class defined in the Worker.** A request that reaches `STORY_ROOM` fails with 500, and `StoryRoom` imports `cloudflare:workers`, which Node cannot load.
  - So `src/worker/storyRoom.ts` and `src/worker/index.ts` are outside Stryker's `mutate` list (`stryker.config.json`). Code there is never mutated.
  - `test/storyRoom.workerd.test.ts` runs it in workerd. Keep route and repo code in modules that never import `cloudflare:*` (see `CLAUDE.md`).
- **Stryker mutates `src/shared`, `src/worker`, `src/client` and `src/ui`**, minus tests, fixtures, the test helpers in `src/ui`, the two files above and the schema file below. `src/app` is not mutated: its routes only re-export, and `_layout.tsx` is wiring with no test.
  - **The `tamagui-style-props` ignorer** (`scripts/strykerStylePropIgnorer.ts`, set under `ignorers` in `stryker.config.json`) skips every mutant inside a JSX attribute that is a Tamagui styling prop. jsdom computes no layout, so no test can tell `gap="4"` from `gap="5"` and those mutants could never be killed. A styling prop is a name in Tamagui's `stylePropsAll`, a shorthand from `tamagui.config.ts`, or `size`, `variant` or `theme`. Handlers, `disabled`, `role`, `aria-*` and copy text are still mutated.
  - `src/worker/db/tableSchemas.ts` is mutated except its string and object literals (a `Stryker disable StringLiteral,ObjectLiteral` comment on its first line), because the description test and the drift test check them. Two mutants remain, one in the 0/1 flag and one in `.min(1)`, and the suite kills both. Because the module's code runs when it loads, each of its mutants reruns the whole suite.
  - `src/worker/db/typeSchemas.ts` is left out because no test loads it (only `import type` reaches it), so its mutants could not be killed.
- **Stryker runs only tests that import a mutated file** (`vitest.related`). A test that imports none is never run there, so a wrong expectation in it passes silently under `pnpm stryker`. `pnpm test` still runs it.
- **`stryker.config.json` must list `@stryker-mutator/vitest-runner` under `plugins`.** Under pnpm, Stryker finds no test runner otherwise.
- **CI runs Stryker in four parallel shards** (`.github/workflows/ci.yml`, job `mutation-area`): `shared`, `worker`, `client` and `ui`. Each shard mutates one folder and runs the whole test suite, and the 80% break threshold applies to each. `stryker.area.config.ts` builds a shard's `mutate` list from `stryker.config.json`, so the excluded files are listed only there. The job `mutation` passes only if every shard did, and is the check the "Protect main" ruleset requires. `pnpm stryker` stays a full local run.
- **CI reuses mutation results**, one incremental file per shard. Stryker keeps a result while the mutated code and the test that killed it are unchanged, and diffs only mutated and test files. A changed helper under an unchanged test keeps its old result until the next full run on `main`. Changing `stryker.config.json`, `stryker.area.config.ts`, a Vitest config or the lockfile starts from no cache.
- **Coverage is checked per file in `src/ui`** (`pnpm test:coverage`, `test.coverage` in `vitest.config.ts`), because a component can be tested through the component that renders it. Every file there must reach 95% of lines and 75% of branches, so no component is left unrun. The floors prove only that the code ran. The `ui` Stryker shard proves a test asserted on it.
- **The `no-restricted-syntax` override in `eslint.config.ts` exists because oxlint has no such rule.** It enforces the database shape rules in `.claude/rules/database.md`.
- **Tests stay on Vitest's Node pool.** `@cloudflare/vitest-pool-workers` would pin an older Vitest.

## Workers AI

- **An `ai` binding is always remote.** `pnpm dev` runs wrangler with remote bindings off, so `env.AI.run()` throws, and local dev uses `AI_PROVIDER=fake`. The opt-in path is in `docs/deployment.md`, "Trying the real model locally".
- **The default model supports JSON-schema output** (`DEFAULT_AI_MODEL` in `src/worker/config.ts`), and so must any model set in `AI_MODEL` ([JSON mode docs](https://developers.cloudflare.com/workers-ai/features/json-mode/)).
  - The output is not guaranteed to match the schema: handle the "JSON Mode couldn't be met" error.
  - JSON mode cannot stream.
- **No real model call has been made.** See "Proven only locally" in `docs/deployment.md`.

## The session cookie

- **WebKit drops a `__Host-` cookie over plain HTTP**, even on `localhost`. Chromium stores it. So the cookie is `__Host-andthen_bt` (Secure, HttpOnly, SameSite=Lax) in preview and production, and plain `andthen_bt` without `Secure` on `http://localhost` only (`src/worker/cookies.ts`).
- **Over real HTTPS it is unchecked.** See "Proven only locally" in `docs/deployment.md`.

## Lint and format

- **oxlint owns every rule it implements, ESLint runs the rest** (`eslint.config.ts`). `eslint-plugin-oxlint` switches off in ESLint every rule that `.oxlintrc.json` runs. Oxlint lacks `@typescript-eslint/no-unnecessary-condition`, so ESLint runs that one.
- **`eslint-plugin-oxlint` must match oxlint's minor version.** It declares a peer range of that minor.
- **Type-aware oxlint uses typescript-go (TypeScript 7), while `tsc` and ESLint use TypeScript 6.** They may disagree on edge cases.
- **`typescript-eslint` caps the TypeScript version.** Check its peer range before raising TypeScript.
- **`as const` is allowed, other assertions are not.** `consistent-type-assertions` with `assertionStyle: "never"` flags `x as T` and `<T>x` in both linters, but not `as const`.
- **oxfmt formats Markdown too**, so `pnpm format:check` covers docs. It ignores `worker-configuration.d.ts` and `pnpm-lock.yaml`.

## pnpm

- **pnpm blocks dependency build scripts.** A package that needs a postinstall must be listed in `allowBuilds` in `pnpm-workspace.yaml`. Today `esbuild` and `workerd` run; `browser-tabs-lock` and `core-js` are listed as `false` so their scripts stay off.
- **`@tamagui/web` and `@tamagui/core` are direct dependencies.** pnpm's isolated linker does not hoist them for the others.

## Expo and the Worker

- **One package holds the Expo app, the Worker and `src/shared`.** `package.json` needs `"main": "expo-router/entry"`, or `expo export` fails to find the app.
- **The type-check config is split so each side sees only its own globals** (`tsconfig.worker.json` has no DOM; `tsconfig.app.json` has DOM and JSX). `tsc` does not stop a Worker file importing `react-native`; only a lint rule could.
- **Routes in `src/app/` are thin re-exports.** Expo Router turns every file there into a route, so a test or a component there would pull Vitest into the Metro bundle. Layout is in `CLAUDE.md`.
- **`web.output` is `"single"`** (`app.json`), paired with `not_found_handling: "single-page-application"`. `"static"` throws React hydration error 418 on unknown paths.
- **The Cloudflare Vite plugin's build drops `assets` from the generated Wrangler config**, so a Vite build plus `wrangler deploy` would ship a Worker with no static assets. The build is the Expo export, then `wrangler deploy --env <name>`; see `docs/deployment.md`.
- **Export under `dist/`.** Oxlint lints any other output folder.
- **`process.env.EXPO_PUBLIC_*` is typed `any`**, so `no-unsafe-assignment` fails on it. Parse it with Zod.
- **`expo start` rewrites `tsconfig.json`.** `scripts/dev.ts` sets `EXPO_NO_TYPESCRIPT_SETUP=1` to stop it.
- **React is pinned to the exact version Expo pins.** `expo install --check` flags any other.
- **The dev server and the Worker are different origins**, so the browser would hit CORS, `requireSameOrigin` and the `SameSite=Lax` cookie. `scripts/dev.ts` puts a proxy on one port; see `docs/deployment.md`.

## Tamagui

- **Components are used stock; only the theme is ours.** The rule and its limits are in `.claude/rules/ui.md`. A bug in a stock component is filed, not worked around: [#26](https://github.com/ebh/andthen/issues/26) (every `Dialog.Close` is named "Dialog Close"), [#27](https://github.com/ebh/andthen/issues/27) (focus lands on `body` after a backdrop click) and [#28](https://github.com/ebh/andthen/issues/28) (the page behind a dialog stays exposed to screen readers).
- **The Metro plugin turns components into class names but never writes their CSS.** Only `tamagui build` does, so a plain `expo export` is unstyled. `pnpm build` wraps the export; see `docs/deployment.md`. `tamagui.build.ts` turns the compiler off in dev, so dev styles come from the `tamagui.generated.css` of the last build.
- **`tamagui build` rewrites sources in place and restores them afterwards.** The restore was checked after normal and failing runs, not after a hard kill.
- **The Tamagui docs are stale in two places.** `disableExtraction` is ignored by the Metro plugin, and the zero-runtime mode fails with "509 forbidden Tamagui module(s)".
- **`Menu` comes from `tamagui`, like every other component.** It is re-exported there, so the app has no direct dependency on the package behind it.
  - The parts are `Menu`, `Menu.Trigger` (with `asChild` on a `Button`), `Menu.Portal`, `Menu.Content`, `Menu.CheckboxItem` with `Menu.ItemIndicator`, `Menu.Item` and `Menu.ItemTitle`. It exposes `role="menu"`, `menuitem` and `menuitemcheckbox`, and the trigger gets `aria-haspopup="menu"`.
  - It renders in jsdom under the component-test setup, and opens on a plain `user.click`.
  - **The stock menu has no look of its own.** `Menu.Content` and the items draw nothing until given documented style props: a `background` fill and a `border-color` hairline on the content, and `bg="hover:highlight focus:highlight"` on each item. Without them the menu is invisible text over the page.
  - **A pseudo state is a clause in the value string**, as in the v6 note below: `focusStyle` and `hoverStyle` are not props.
  - **A disabled item shows `data-disabled`**, not the `disabled` attribute.
- **Blur is the documented `filter` style prop** (`filter="blur(4px)"`, one of the typed presets). It works on web and needs no `expo-blur`. Native blur was not checked: the app is web-only, and `expo export` for web builds with it.
- **The blur sits on a child, not on the pressable span.** A filter on the element blurs its own focus ring.
- **`focusVisibleStyle` and `userSelect` are not accepted on `Text`.** The stand-in keeps the browser's own focus ring, which shows in both themes.
- **In the v6 config, tokens take no `$` prefix and only shorthands are allowed.** Media conditions go inside value strings, and unitless numbers inside those strings are silently ignored.

## Clerk

- **`@clerk/backend` `verifyToken` runs under workerd**, and with `jwtKey` it checks the signature with no network call (`src/worker/sessionToken.ts`, `test/storyRoom.workerd.test.ts`).
- **`CLERK_JWT_KEY` must be an RSA-2048 public key in SPKI PEM form** (`-----BEGIN PUBLIC KEY-----`). `test/support/sessionToken.ts` makes one per test run.
- **Clerk checks `authorizedParties` only when the token has an `azp` claim.** The Worker therefore rejects a token without one (`docs/api.md`).
- **`@clerk/expo` works on web through `@clerk/expo/web`**, with `routing="hash"` and `withSignUp` (`src/ui/SignIn.tsx`). `tokenCache` is undefined on web.
- **Clerk draws input and button borders as box-shadows at a fixed 11% opacity of `colorBorder`.** In dark mode a dark `colorBorder` disappears, so `colorBorder` maps to the theme's text colour.
- **Google sign-in on web needs `expo-web-browser`**, which is not added. Clerk logs "expo-web-browser not available". Only email sign-in works.
- **Headless Chromium fails Clerk's bot check at sign-up.** Headed Chromium passes, so the e2e tests cover anonymous journeys only.

## Not checked

- Android beyond a successful export.
- A real device, a screen reader, and Firefox and WebKit for the app. Tamagui's `AlertDialog` has the same gap.
- A real `beforeinstallprompt`. Headless Playwright never fires it, so tests send a synthetic event, and the "Install the app" button is to be checked by hand on a real Android device.
- The compiler's restore after a hard kill of `tamagui build`.
