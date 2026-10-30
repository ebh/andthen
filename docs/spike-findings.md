# Spike findings (Phase 0)

Checked on 2026-10-30 by running each item, not just reading docs.

## Versions

| Tool                                            | Version                    | Why this one                                                                                                                                        |
| ----------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node                                            | 26.13.0 (`.node-version`)  | Plan.                                                                                                                                               |
| pnpm                                            | 12.16.1 (`packageManager`) | Plan.                                                                                                                                               |
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

pnpm 12 blocks dependency build scripts. `pnpm-workspace.yaml` `allowBuilds` allows `esbuild` and `workerd`; add any new package that needs a postinstall there.

## Stryker drives both pure and Miniflare-backed D1 tests: yes

- Integration tests run in Vitest's Node pool. `test/support/testEnv.ts` gets bindings from wrangler's `getPlatformProxy` (Miniflare underneath), in memory, with every `migrations/*.sql` applied in one batch.
- The Hono app runs in the test process (`app.request(path, init, env)`), so Stryker instruments it. With `coverageAnalysis: "perTest"`, Miniflare-backed tests killed mutants in `src/worker/app.ts` (19 of 20).
- **Limit:** `getPlatformProxy` cannot run a Durable Object class defined in the Worker itself. A request that reaches `STORY_ROOM` fails with 500. `StoryRoom` also imports `cloudflare:workers`, which Node can't load.
  - So `src/worker/storyRoom.ts` and `src/worker/index.ts` are out of the mutate set. Testing `StoryRoom` (Phase 4) needs the built Worker in workerd, e.g. wrangler's `createTestHarness` or `unstable_startWorker`. Code there won't be mutated.
  - Keep route and repo code in modules that never import `cloudflare:*`, so they stay mutable. That is why the Hono app lives in `src/worker/app.ts` and `index.ts` only re-exports.
- Miniflare 5 (a beta, pulled in by wrangler 4.15x) changed the `new Miniflare()` options shape. Use `getPlatformProxy` rather than Miniflare directly.
- Stryker needs `"plugins": ["@stryker-mutator/vitest-runner"]` under pnpm, or it finds no test runner.

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
- So Phase 5 should: keep the `fake` provider as the local default, set `remoteBindings: false` (or gate it behind an env var for people who are logged in), and pass `remoteBindings: false` in tests (the harness already does).
- JSON-schema output (`response_format: { type: "json_schema", json_schema }`) is supported by `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, the plan's default, among others ([JSON mode docs](https://developers.cloudflare.com/workers-ai/features/json-mode/)). Output is not guaranteed to match: handle the "JSON Mode couldn't be met" error. No streaming in JSON mode.
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

WebKit accepts `Secure` on localhost but rejects the `__Host-` prefix over HTTP. Phase 3 must pick one (open question for the owner):

- Use `__Host-andthen_bt` over HTTPS and `andthen_bt` (still Secure, HttpOnly) when the request is `http://localhost`.
- Serve dev over HTTPS (e.g. `@vitejs/plugin-basic-ssl`) and keep one name.
- Keep one name and run local and e2e checks in Chromium only.
