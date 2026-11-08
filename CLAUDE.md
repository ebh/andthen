# andthen.page

A group writes a story in turns. One Cloudflare Worker (Hono) serves `/api/*`, static assets serve the Expo web export, D1 holds all story data, and the `StoryRoom` Durable Object fans out live updates and runs the story's turn timeout alarm.

## Rules

- **Parse untyped data with Zod; never assert types.** `as`, `<T>x` and `!` fail lint, tests included. `as const` is fine. Untyped data means `req.json()`, `res.json()`, D1 rows (parse the result; no `.first<T>()`), WebSocket messages and AI output.
- **Shared contracts live in `src/shared/`**, pure and runnable in both Worker and browser. API request/response schemas go in `src/shared/api.ts`.
- **Keep Worker logic out of files that import `cloudflare:*`.** Those files can't run in Node, so Stryker can't mutate them. `src/worker/app.ts` holds the Hono app; `src/worker/index.ts` only re-exports it with `StoryRoom`.
- **After changing bindings in `wrangler.jsonc`, run `pnpm cf-typegen`** and commit `worker-configuration.d.ts`. CI fails if it is stale.
- **A new D1 change is a new file in `migrations/`.** Never edit an applied migration.

## Where things live

- `src/shared/`: validation, turn rules, API schemas. `src/worker/`: Hono app, `StoryRoom`, D1 access. `src/app/`, `src/ui/` and `src/client/`: the Expo app.
- Client layout: `src/app/` holds the Expo Router routes as thin re-exports and nothing else. Pages, components and their tests live in `src/ui/`, because Expo Router treats every file in `src/app/` as a route. Never create a root `app/` folder: Expo Router would then ignore one of the two. `src/client/` is plain logic with no UI: `api.ts` is the only code that calls `fetch` (Zod-parsed, failures as values); `live.ts` is the live-socket logic; `storyRules.ts` decides what the UI offers (e.g. whether to show skip, mirroring `skip` in `turnOrder.ts`). Component tests (`*.test.tsx`) start with `// @vitest-environment jsdom`; Vitest aliases `react-native` to `react-native-web`.
- `src/serviceWorker/` is a thin shell for the service worker, built to `dist/sw.js` by `scripts/buildServiceWorker.ts`; the logic that registers it and applies updates lives in `src/client/appUpdate.ts`, where tests and Stryker reach it. `public/` holds the web app manifest and the `index.html` head that Expo exports with.
- Tests follow `.claude/rules/testing.md` and the level files it names. Unit tests sit beside the code (`*.test.ts`). Integration tests are in `test/`, moving beside their route modules; Playwright e2e tests are in `e2e/` (`pnpm e2e`, run once `pnpm e2e:install`; CI runs them in their own job); `test/support/testEnv.ts` gives a Miniflare `env` with a fresh in-memory D1 and all migrations applied.
- Lint is oxlint first (owns every rule it implements, type-aware), then ESLint for what oxlint lacks. Add a rule to `.oxlintrc.json` if oxlint has it, else to `eslint.config.ts`.

## Before you push

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm stryker` must all pass. `pnpm build` produces `dist/`, which the Worker serves. Stryker breaks below an 80% mutation score.

## Background

- `docs/domain.md`: the app's terms, each with one meaning, and the words reserved for planned features. Read it before naming a concept, type, table, route or UI label.
- `docs/api.md`: the story and account routes, error statuses, request guards, how a request is identified (session token or cookie), write guards and test helpers (`createApp`, `createBrowser`, `gateLoads`). Read it before adding a route or changing how writes are guarded.
- `docs/deployment.md`: local vs preview vs production, first-time Cloudflare setup, the domain, smoke tests, accepted risks, and what is proven only locally. Read it before changing `wrangler.jsonc`, `deploy.yml`, how an environment is built or how the service worker is served.
- `docs/constraints.md`: what Stryker, Workers AI, the lint tools, the `__Host-` cookie, Expo, Tamagui and Clerk force on the code. Read it before changing the toolchain, test harness or cookie handling.
