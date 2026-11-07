# Toolchain spike findings

Checked on 2026-10-30 by running each item, not just reading docs.

## Versions

| Tool                                            | Version                    | Why this one                                                                                                                                        |
| ----------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node                                            | 26.13.0 (`.node-version`)  | Pinned up front.                                                                                                                                    |
| pnpm                                            | 12.16.1 (`packageManager`) | Pinned up front.                                                                                                                                    |
| TypeScript                                      | 6.0.3                      | `typescript-eslint` 8.72 needs `<6.1`. TS 7 (Go) is out. oxlint's type-aware mode ships its own typescript-go, so it isn't held back.               |
| wrangler                                        | 4.154.0                    | Matches the version `@cloudflare/vite-plugin` 1.66.0 depends on, so one `workerd` is installed. 4.156.0 is younger than pnpm's minimum release age. |
| `@cloudflare/vite-plugin`                       | 1.66.0                     |                                                                                                                                                     |
| Vite / Vitest                                   | 8.3.5 / 5.0.5              | Vitest 5 is fine because tests use the Node pool. `@cloudflare/vitest-pool-workers` would pin Vitest 4.                                             |
| Stryker (core + vitest-runner)                  | 10.1.1                     |                                                                                                                                                     |
| oxlint / oxlint-tsgolint / eslint-plugin-oxlint | 1.90.0 / 7.0.2005 / 1.90.0 | `eslint-plugin-oxlint` must match oxlint's minor (peer `~1.90.0`).                                                                                  |
| oxfmt                                           | 0.75.0                     |                                                                                                                                                     |
| ESLint / typescript-eslint                      | 10.13.0 / 8.72.1           |                                                                                                                                                     |
| Tailwind / DaisyUI                              | 4.3.3 / 5.7.50             |                                                                                                                                                     |
| React / Hono / Zod                              | 19.3.1 / 4.13.14 / 4.6.7   |                                                                                                                                                     |
| Expo / Expo Router                              | 58.0.22 / ~58.0.29         | Current SDK when checked. Expo pins React to 19.3.0 exactly; `expo install --check` flags the repo's 19.3.1.                                        |
| React Native / react-native-web                 | 0.88.1 / ~0.21.4           | The versions Expo 58 pins.                                                                                                                          |
| React Native Paper                              | 5.15.4                     | The UI kit. 6.x is an alpha. Younger than pnpm's minimum release age, so it needs `minimumReleaseAgeExclude`.                                       |

pnpm 12 blocks dependency build scripts. `pnpm-workspace.yaml` `allowBuilds` allows `esbuild` and `workerd`; add any new package that needs a postinstall there.

## Stryker drives both pure and Miniflare-backed D1 tests: yes

- Integration tests run in Vitest's Node pool. `test/support/testEnv.ts` gets bindings from wrangler's `getPlatformProxy` (Miniflare underneath), in memory, with every `migrations/*.sql` applied in one batch.
- The Hono app runs in the test process (`app.request(path, init, env)`), so Stryker instruments it. With `coverageAnalysis: "perTest"`, Miniflare-backed tests killed mutants in `src/worker/app.ts` (19 of 20).
- **Limit:** `getPlatformProxy` cannot run a Durable Object class defined in the Worker itself. A request that reaches `STORY_ROOM` fails with 500. `StoryRoom` also imports `cloudflare:workers`, which Node can't load.
  - So `src/worker/storyRoom.ts` and `src/worker/index.ts` are out of the mutate set. Testing `StoryRoom` needs the built Worker in workerd, e.g. wrangler's `createTestHarness` or `unstable_startWorker`. Code there won't be mutated.
  - Keep route and repo code in modules that never import `cloudflare:*`, so they stay mutable. That is why the Hono app lives in `src/worker/app.ts` and `index.ts` only re-exports.
- Miniflare 5 (a beta, pulled in by wrangler 4.15x) changed the `new Miniflare()` options shape. Use `getPlatformProxy` rather than Miniflare directly.
- Stryker needs `"plugins": ["@stryker-mutator/vitest-runner"]` under pnpm, or it finds no test runner.
- CI runs Stryker in its own `mutation` job: `--incremental` on pull requests and on pushes to `main`. A push to `main` adds `--force` (every mutant) only when no cache matched the current config, Vitest and lockfile hash. Local `pnpm stryker` stays a full run.
  - Stryker reuses a cached result when the mutated code and the test that killed it are unchanged. It diffs only mutated and test files.
  - So a changed helper under an unchanged test keeps its old result until the next `main` run. The cache key hashes `stryker.config.json`, the Vitest config and the lockfile, so changes there start from no cache.

## `@cloudflare/vite-plugin` serves SPA, `/api/*` and a hibernating DO WebSocket: yes

- `pnpm dev` and `pnpm build && pnpm preview`: `/api/health` returns JSON from the Worker; `/abc12` returns the SPA's `index.html`; `/api/nope` returns 404; `ws://…/api/stories/abc12/live` upgrades and gets `pong` for `ping`.
  - The `ping`/`pong` reply is `setWebSocketAutoResponse`, which answers without waking a hibernated object.
- Environments are picked at build time: `CLOUDFLARE_ENV=preview pnpm build`, then `wrangler deploy --dry-run` with no `--env`. Wrangler reads the redirected config `dist/<top-level name>/wrangler.json`.
  - Dry-run for `preview` and `production` each listed `DB` (`andthen-preview` / `andthen-prod`) and `STORY_ROOM`. Production carries the `app.andthen.page` custom domain. The top-level `migrations` (`new_sqlite_classes`) are inherited by each env.
  - The output folder is named after the top-level `name` (`dist/andthen_dev/`) whichever env was built.

## Tailwind v4 + DaisyUI 5 in CSS only: yes

`src/client/styles.css` is `@import "tailwindcss"; @plugin "daisyui";` with `@tailwindcss/vite`. There is no `tailwind.config`. DaisyUI classes (e.g. `.badge-outline`) appear in the built CSS.

## Workers AI locally

- An `ai` binding is always remote. With it in the top-level config, `pnpm dev` **fails to start** without Cloudflare credentials ("Failed to start the remote proxy session… set a CLOUDFLARE_API_TOKEN").
- With `cloudflare({ remoteBindings: false })` in `vite.config.ts`, dev starts and `env.AI.run()` throws `Binding AI needs to be run remotely`. Wrangler warns that AI bindings "may incur usage charges even in local dev".
- **Decided:** local dev uses `AI_PROVIDER=fake` with `remoteBindings: false` by default. The real model is opt-in: `AI_REMOTE=1 pnpm dev` (a shell variable that `vite.config.ts` reads to turn remote bindings on) with `AI_PROVIDER=workers-ai`, after a Cloudflare login. That path has not been run. Tests pass `remoteBindings: false` (the harness already does). Preview and production set `AI_PROVIDER=workers-ai`.
- JSON-schema output (`response_format: { type: "json_schema", json_schema }`) is supported by `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, the default model, among others ([JSON mode docs](https://developers.cloudflare.com/workers-ai/features/json-mode/)). Output is not guaranteed to match: handle the "JSON Mode couldn't be met" error. No streaming in JSON mode.
- No remote AI call was made.

## `as const` passes `consistent-type-assertions` with `assertionStyle: 'never'`: yes

Both ESLint and oxlint flag `x as T`, `<T>x` and `(null as T | null)`, but not `["a"] as const` or `{…} as const`.

## oxlint coverage and oxfmt

- oxlint 1.90 implements 73 of the 74 rules `strictTypeChecked` turns on, including the type-aware ones (`no-floating-promises`, `no-unsafe-*`, `restrict-template-expressions`, …) through `oxlint-tsgolint`, and `consistent-type-assertions`. The one it lacks is `@typescript-eslint/no-unnecessary-condition`.
  - On a fixture with an assertion, `any`, unsafe member access, a floating promise, a template with `unknown` and a non-null assertion, oxlint and ESLint reported the same findings.
- So `.oxlintrc.json` turns on those 73 rules (with the same options) plus `consistent-type-assertions: never`, and `typeAware: true`. `eslint.config.ts` loads `strictTypeChecked` and then `eslint-plugin-oxlint`'s `buildFromOxlintConfigFile(…, { typeAware: true })`, which switches off every rule oxlint runs. ESLint is left running `no-unnecessary-condition`.
  - tsgolint uses typescript-go (TS 7) while `tsc` and ESLint use TS 6.0.3, so they may disagree on edge cases.
- oxfmt formats TS, TSX, JSON, JSONC (keeps comments and trailing commas), CSS and Markdown. `worker-configuration.d.ts` (generated) and `pnpm-lock.yaml` are ignored.

## `__Host-` Secure cookie on `http://localhost`: Chromium yes, WebKit no

Checked with Playwright 1.64.1 against a plain HTTP server on `localhost` and `127.0.0.1`:

| Cookie                                               | Chromium 156 | WebKit 27.2 |
| ---------------------------------------------------- | ------------ | ----------- |
| `__Host-a=1; Path=/; Secure; HttpOnly; SameSite=Lax` | stored       | **dropped** |
| `b=1; Path=/; Secure; HttpOnly; SameSite=Lax`        | stored       | stored      |
| `c=1; Path=/; HttpOnly; SameSite=Lax`                | stored       | stored      |

WebKit accepts `Secure` on localhost but rejects the `__Host-` prefix over HTTP.

**Decided:** the cookie is `__Host-andthen_bt` (Secure, HttpOnly, SameSite=Lax) in preview and production. On `http://localhost` only, it is plain `andthen_bt` without `Secure`.

## Expo and React Native

Checked on 2026-11-04 by building and running a scratch app against a copy of this repo. The Expo screens were not run on a device. The only native run was one screen on the iOS simulator under Expo Go.

### One package holds the Expo app, the Worker and `src/shared`: yes

- `expo export --platform web`, `ios` and `android` all succeed with pnpm's isolated linker. No hoisting and, before Tamagui, no `metro.config.js`, and `src/shared` (Zod) bundles into all three.
- `package.json` needs `"main": "expo-router/entry"`, or `expo export` fails with "Unable to resolve module ../../App".
- `tsc -b` needs a split, so Worker code doesn't see React Native types and the app doesn't see Workers globals:
  - `tsconfig.app.json`: `lib: ["ES2024"]` with no DOM, `jsx: react-jsx`, `customConditions: ["react-native"]`, for `app`, `src/client` and `src/shared`, excluding test files.
  - `tsconfig.app-test.json`: the same with `DOM` added, for `*.test.tsx`, because Testing Library returns DOM elements.
  - tsc does not stop a Worker file importing `react-native`. Only a lint rule could.
- `*.test.tsx` and screens must sit outside `app/`. Expo Router turns every file there into a route, so a test pulls Vitest and Vite into the Metro bundle and the export fails. Keep `app/*.tsx` as thin re-exports of `src/client`.
- Export to a folder under `dist/`. Oxlint lints any other output folder.
- `process.env.EXPO_PUBLIC_*` is typed `any`, so the `no-unsafe-assignment` rule fails on it. Parse it with Zod.
- `expo start` rewrites `tsconfig.json`. Set `EXPO_NO_TYPESCRIPT_SETUP=1`.
- React 19.3.0 is required. Bundling, tests and `tsc` passed with 19.3.1, but it was not run on a device.
- Oxlint and ESLint needed no config change. The workspaces layout (`apps/mobile` plus `packages/shared`) was not tried, because one package worked.

### The Worker serves the Expo web export: yes, but the build and deploy flow changes

- `web.output: "single"` (one `index.html`) works with `not_found_handling: "single-page-application"`: `/`, `/abc12` and unknown paths all load the app. `static` throws a hydration error (React error 418) on unknown paths and gains nothing here.
- With `assets.directory` pointing at the export, `wrangler dev` serves `/api/health`, the app at `/` and `/abc12`, a 404 JSON at `/api/nope`, hashed assets, and the live WebSocket (`ping` gets `pong`).
- `@cloudflare/vite-plugin` can run the Worker alone, but its build drops `assets` from the generated Wrangler config. So `vite build` plus `wrangler deploy` would upload a Worker with no static assets.
  - The replacement is `expo export --platform web --output-dir dist/web`, then `wrangler deploy --env <name>` with no Vite build. A dry run listed the assets and the right `DB` and `STORY_ROOM` bindings for `preview` and `production`. Each env inherits the `assets` block.
  - `ci.yml`, `deploy.yml` and the Playwright `webServer` (`vite preview` today) must change. The Playwright change was not tested.
- Dev loop: the Expo dev server and `wrangler dev` are different origins, so the browser hits CORS, `requireSameOrigin` and the `SameSite=Lax` cookie. A small reverse proxy on one port fixed it with no Worker change: `/api/*`, including the WebSocket upgrade, goes to `wrangler dev` and everything else goes to Metro. Fast refresh worked through it. The alternative is `wrangler dev` serving a rebuilt export (about 1.4 s, no hot reload).

### Mobile tests and Stryker

- Vitest with `react-native` aliased to `react-native-web` and jsdom runs the Node tests and the React Native component tests together (479 tests in about 5 s). Elements are found by role, label and text only.
- Stryker mutates only `src/shared` and `src/worker`, so mobile code is never mutated. The score stayed at 98.10 with and without mobile tests.
- Stryker's Vitest runner runs only tests that import a mutated file (`vitest.related` is on by default). A mobile test that imports `src/shared` joins the dry run, and a failure in it stops the whole run. One that imports no mutated file is never run by Stryker, so a wrong expectation in it passes silently there. `pnpm test` still runs it.
- Timing was not compared like for like, because the spike also removed the old client tests.

### UI kit: Tamagui 3.1.10, used stock, compiler on

daisyUI cannot run in React Native. Six candidates each built the same story-page slice (heading, status banner, textarea, checkbox, buttons, error, author toggle, margin layout at 768px and up). Contrast passed in all (lowest 4.89:1). Native was compile-only except for Paper.

| Candidate            | Lines written     | Native bundle | Packages added | Ready-made, of 10 | Main risk                                                 |
| -------------------- | ----------------- | ------------- | -------------- | ----------------- | --------------------------------------------------------- |
| Plain styles         | 679               | 2.5 MB        | about 0        | 0                 | Most hand-written code                                    |
| NativeWind 4.2.7     | about 500         | 3.7 MB        | 40             | 0                 | Tailwind 3. `react-native-css-interop` added by hand.     |
| React Native Paper   | 518               | 3.1 MB        | 2              | about 4           | Accessibility gaps on web (below)                         |
| Tamagui 3.1.10       | 386               | 3.9 MB        | 271            | about 4.5         | Compiler-on export needs a wrapped `tamagui build` step   |
| Gluestack UI v5      | about 229 + 4,436 | 4.7 MB        | 90             | 5                 | Release candidate. Vendored code breaks the no-`as` rule. |
| HeroUI Native 1.0.11 | about 298         | 5.5 MB        | 149            | about 7           | Heaviest. Open web bugs in overlay components.            |

**Decided:** Tamagui, with stock components and only the theme ours (light and dark themes, Source Serif 4 and Inter). Components do what Tamagui's docs say they can do. A bug in a stock component is filed as an issue, not worked around.

Checks on web (Chromium) with react-native-web 0.21:

- `Checkbox` has role `checkbox` with `aria-checked`, `Switch` has role `switch`, and `Button` passes `aria-pressed` through. `Label htmlFor` names them. Every control gets a 2px focus outline. 4 of 4 role-based Vitest tests passed.
- The `md` breakpoint is built in.
- Checkbox and switch frames are 22px tall, and the label row is 44px. Touch size is settled in `ui.md`.
- On web, semi-bold renders from the regular font file.
- It adds 271 packages. pnpm needs `@tamagui/web` and `@tamagui/core` as direct dependencies.
- The v6 config API has no `$` prefix on tokens and allows only shorthands. Media conditions go inside value strings, and unitless numbers inside those strings are silently ignored.
- Releases are frequent. `@tamagui/metro-plugin` had 12 releases in 15 days (2026-10-20 to 2026-11-03).

**Dialog** (`Dialog` from `tamagui`, unstyled; its look comes from the docs' copy-paste "skin"). It exposes `role="dialog"`, `aria-modal`, and a name and description from the title and text. Focus moves in on open, Tab and Shift+Tab stay inside, and Escape closes it. Focus returns to the trigger after Escape, Cancel or Leave. It works under StrictMode and adds 887 B gzip. Three stock bugs, each to be filed as an issue:

1. `Dialog.Close` hard-codes `aria-label="Dialog Close"`, so both buttons are named "Dialog Close" and `getByRole("button", { name: "Leave story" })` fails.
2. Focus lands on `body` after a click on the overlay, and after any close of a dialog opened from code with no trigger.
3. The background gets no `aria-hidden` or `inert`; only `aria-modal` guards it. Unconfirmed: no screen reader was tested.

**The compiler** (`@tamagui/cli/metro`, Tamagui's intended path for production):

- The default `withTamagui` Metro plugin turns components into `div`s with atomic class names but never writes the CSS for them. A plain `expo export` is unstyled (34 classes with no rule), in 3.1.10 and in 3.2.0. Dev is unstyled too, with a "global config fallback" warning.
- `tamagui build` writes that CSS. The production build is a wrapped command, one folder per call:

  ```
  tamagui build --target web ./app -- tamagui build --target web ./components -- expo export --platform web
  ```

  It rewrites sources in place and restores them afterwards. The restore was checked after normal and failing runs, not after a hard kill. It also writes `tamagui.generated.css`.

- `metro.config.js` is `withTamagui(getDefaultConfig(__dirname))`. `tamagui.build.ts` sets `config`, `components: ["tamagui"]`, `outputCSS` and `disable: isDev`. Dev runs with the compiler off.
- Output parity: light and dark at 375px and 1280px are byte-identical to compiler off. The Dialog checks and role tests give the same results. The compiler drops a redundant `role="heading"` from the `<h1>`.
- The docs are stale here. `disableExtraction` is ignored by the Metro plugin, and the docs' saving from `outputCSS` does not hold on Metro. The experimental zero-runtime mode fails with "509 forbidden Tamagui module(s)".
- Cost, production web export, compiler off against on:

  | Variant                       | JS raw / gzip       | CSS raw / gzip | Cold export |
  | ----------------------------- | ------------------- | -------------- | ----------- |
  | Compiler off                  | 2,109,647 / 546,702 | 26,267 / 3,839 | about 4 s   |
  | Compiler on, wrapped (styled) | 2,110,430 / 546,881 | 30,227 / 5,797 | about 17 s  |

  First paint was the same in all variants (median 712 ms), and is gated by font loading, so it does not separate them.

- Both native exports bundle with the compiler on. Nothing ran on a device.

#### Rejected: React Native Paper

Paper with only a theme looked close to the web design, but its web accessibility has gaps. Checks of the stock components on web (Chromium) with react-native-web 0.21:

- No checked or selected state is exposed. Paper passes the legacy `accessibilityState`, which react-native-web 0.21 drops. `Checkbox.Item` is a checkbox with no `aria-checked`, and `Chip selected` is a button with no `aria-pressed`. A standalone `Checkbox` with `aria-label` and `aria-checked` works.
- `Dialog` has no `role="dialog"` or `aria-modal`. Focus is not trapped or moved in, Escape does not close it, and focus is lost on close. Paper's docs say its Modal is not accessible by default.
- A closed `Menu` moves focus to its anchor button when its parent re-renders. Open, Escape and focus return work. Arrow keys do nothing.
- `Button`, `Switch` (with `aria-label`) and `Text` roles and levels work as shipped. `HelperText` needs `role="alert"` and conditional rendering, since `visible={false}` leaves the text in the DOM. The multiline `TextInput` needs `aria-label`, or it is named by its placeholder. `Snackbar` needs `role="status"`.
- Chromium's default focus ring shows on every control with no custom CSS. Firefox and WebKit were not run.
- Touch targets under 44px at 375px wide: `Button` 40px, `Chip` 32px, `Switch` 40 by 20, dialog buttons 38px. `Checkbox.Item` (52px) and `Menu` items (48px) pass.
- Paper has no breakpoint helper. Use `useWindowDimensions`.
- On web Paper loads `MaterialCommunityIcons.ttf` (1.3 MB). Its `settings.icon` option does not cover it, because `Checkbox`, `Chip` and `Snackbar` import the icon component directly. A Metro `resolveRequest` redirect of both `@expo/vector-icons/MaterialCommunityIcons` and `react-native-vector-icons/MaterialCommunityIcons` to a stub removes the font and 192 KB of JavaScript. The stub draws only the icons it lists and throws on any other name.
- On iOS an unchecked `Checkbox` draws nothing, because it renders as `CheckboxIOS`. Web and Android draw an outlined box.
- Fonts: `expo-font` with per-weight `@expo-google-fonts/*` sub-path imports works on web and is bundled into both native exports (the package root imports every weight). Four static TTFs are 1.35 MB raw, against about 99 KB for the current variable `woff2` files. Whether a variable font works on native was not checked.
- Dark mode follows the OS on web through `prefers-color-scheme` and on the iOS simulator under Expo Go, with no `userInterfaceStyle` and no `expo-system-ui` code. A production build may differ.

### Not checked

- Android: no emulator on the machine, so only the export was checked.
- A real device, a screen reader, Firefox and WebKit.
- The Paper `Dialog`, `Menu` and `Snackbar` on a device.
- Tamagui: Safari and Firefox, Tamagui's `AlertDialog`, a device, and whether Expo Router turns on StrictMode itself.
- The wrapped `tamagui build` in CI, the zero-runtime islands mode, and a hard kill of `tamagui build` mid-run.
- The edited `ci.yml`, `deploy.yml` and Playwright config.

## Clerk accounts

### Worker side: `@clerk/backend` under workerd, yes

- `@clerk/backend` 3.27.0 `verifyToken` with `jwtKey` runs under workerd. `test/storyRoom.workerd.test.ts` imports it and verifies a token there.
- With `jwtKey` it checks the signature locally and makes no network call.
- The key must be an RSA-2048 public key in SPKI PEM form (`-----BEGIN PUBLIC KEY-----`). `test/support/sessionToken.ts` makes such a key per test run.
- `authorizedParties` is checked only when the token has an `azp` claim, so the Worker rejects a token that has none (`src/worker/sessionToken.ts`).

### Client side: `@clerk/expo` on Expo 58 and react-native-web, yes

- `@clerk/expo` 4.15.1 works on Expo 58 with react-native-web.
- `<SignIn/>` comes from `@clerk/expo/web`, used with `routing="hash"` and `withSignUp`.
- `tokenCache` is undefined on web.
- `pnpm-workspace.yaml` sets `browser-tabs-lock: false` and `core-js: false` in `allowBuilds`, so their install scripts do not run.
- Clerk 6.42.3 draws input and button borders as box-shadows at a fixed 11% opacity of `colorBorder`, so in dark mode a dark `colorBorder` disappears. `colorBorder` maps to the theme's text colour.
- Clerk logs "expo-web-browser not available, OAuth/SSO on web will not work". Google sign-in on web therefore needs `expo-web-browser`, which is not added. Only email sign-in works today.
- Headless Chromium fails Clerk's bot check at sign-up. Headed Chromium passes. The e2e tests therefore cover anonymous journeys only.

## Known gaps to review before production

- `/api/health` runs a D1 query for any unauthenticated caller. Fine while nothing is deployed; review its cost and exposure before production.
- `requireSameOrigin` rejects a request with no `Origin` header. iOS and Android `fetch` and `WebSocket` send none, so native apps cannot write or go live until the Worker accepts a second credential. This was read from the code, not run on a device.
