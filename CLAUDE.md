# andthen.page

A group writes a story in turns. One Cloudflare Worker (Hono) serves `/api/*`, static assets serve the React SPA, D1 holds all story data, and the `StoryRoom` Durable Object only fans out live updates.

## Rules

- **Parse untyped data with Zod; never assert types.** `as`, `<T>x` and `!` fail lint, tests included. `as const` is fine. Untyped data means `req.json()`, `res.json()`, D1 rows (parse the result; no `.first<T>()`), WebSocket messages and AI output.
- **Shared contracts live in `src/shared/`**, pure and runnable in both Worker and browser. API request/response schemas go in `src/shared/api.ts`.
- **Keep Worker logic out of files that import `cloudflare:*`.** Those files can't run in Node, so Stryker can't mutate them. `src/worker/app.ts` holds the Hono app; `src/worker/index.ts` only re-exports it with `StoryRoom`.
- **After changing bindings in `wrangler.jsonc`, run `pnpm cf-typegen`** and commit `worker-configuration.d.ts`. CI fails if it is stale.
- **A new D1 change is a new file in `migrations/`.** Never edit an applied migration.

## Where things live

- `src/shared/`: validation, turn rules, API schemas. `src/worker/`: Hono app, `StoryRoom`, D1 access. `src/client/`: React SPA.
- Unit tests sit beside the code (`*.test.ts`). Integration tests are in `test/`; `test/support/testEnv.ts` gives a Miniflare `env` with a fresh in-memory D1 and all migrations applied.
- Lint is oxlint first (owns every rule it implements, type-aware), then ESLint for what oxlint lacks. Add a rule to `.oxlintrc.json` if oxlint has it, else to `eslint.config.ts`.

## Before you push

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm stryker` must all pass. Stryker breaks below an 80% mutation score.

## Background

- `docs/spike-findings.md`: tool versions and what was proven about Stryker, the Vite plugin, Workers AI locally, lint coverage and the `__Host-` cookie. Read it before changing the toolchain, test harness or cookie handling.
