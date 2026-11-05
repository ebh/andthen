# andthen.page

A group writes a story together, one passage each, in turns.

- Someone starts a story with an opening passage and shares the link. Anyone with the link can join with a name.
- Writers take turns in a fixed rotation. A turn lasts 24 hours; if the writer doesn't write, the turn moves on. Anyone else in the story can skip the writer whose turn it is.
- The home page lists every story you're in, so you don't need to keep the links. You can leave a story and rejoin it later from its link.
- Every open page updates live, with no reload.
- The writer whose turn it is can ask for three AI suggestions. A suggestion only fills the text box; the writer decides what to send.

It runs on Cloudflare: one Worker (Hono) serves `/api/*` and the React app's static files, D1 stores the stories, and a Durable Object (`StoryRoom`) pushes live updates. Suggestions come from Workers AI.

## Run it locally

Needs Node 26.13.0 and pnpm 12.16.1. No Cloudflare account or login is needed.

1. Install Node at the version in `.node-version` with any version manager that reads it (for example [fnm](https://github.com/Schniz/fnm): `fnm install && fnm use`), then install pnpm:
   ```sh
   npm install -g pnpm@12.16.1
   ```
2. Install the dependencies:
   ```sh
   pnpm install
   ```
3. Create the local database tables (answer `y` if Wrangler asks to apply the migration):
   ```sh
   pnpm db:migrate:local
   ```
4. Start the app (the Expo dev server and the Worker behind one address). Wrangler warns that AI bindings "may incur usage charges"; that is expected, and nothing calls Workers AI unless you set `AI_REMOTE=1` (see below).
   ```sh
   pnpm dev
   ```
5. Open <http://localhost:5173>. Use `localhost`, not `127.0.0.1`: the login cookie only works without HTTPS on `localhost`.

What you should see: a form asking for your name and an opening passage. Start a story and the Worker creates it and sends you to `/<5 characters>`. That page, along with joining, the story itself and your list of stories, is not in the new app yet, so you land on the not-found page. The API behind them works; see [docs/api.md](docs/api.md).

Local data lives in `.wrangler/state`; delete that folder to start clean. Copy `.dev.vars.example` to `.dev.vars` to change local variables. To try the real model, see [docs/deployment.md](docs/deployment.md#trying-the-real-model-locally).

## Commands

| Command                 | Does                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`              | Expo dev server and the Worker (local D1, fake suggestions) on one address.               |
| `pnpm build`            | Export the web app into `dist/`, which the Worker serves as static assets.                |
| `pnpm db:migrate:local` | Apply `migrations/` to the local database.                                                |
| `pnpm format`           | Format with oxfmt (`format:check` only checks).                                           |
| `pnpm lint`             | oxlint (type-aware), then ESLint for the rules oxlint lacks.                              |
| `pnpm typecheck`        | `tsc -b` over the app, Worker, tests, e2e and tooling.                                    |
| `pnpm test`             | Vitest: unit tests, component tests and Miniflare-backed integration tests.               |
| `pnpm e2e`              | Playwright in Chromium against a fresh build and database. Needs `pnpm e2e:install` once. |
| `pnpm stryker`          | Mutation tests over `src/shared`, `src/worker` and `src/client`.                          |
| `pnpm cf-typegen`       | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc`.                             |

## Tests

- **Unit and integration (`pnpm test`).** Test files sit beside the code (`*.test.ts`) and in `test/`. They need no browser and finish in seconds. A passing run ends with `Test Files  N passed`.
- **End to end (`pnpm e2e`).** Run `pnpm e2e:install` once to download Chromium. Each run builds the app, creates a new local database in `.wrangler/e2e-state` and serves the build from the Worker on port 4173, so it never touches your `pnpm dev` data. A passing run ends with `2 passed`; on failure, open `playwright-report/index.html` or `test-results/`.
- **Mutation (`pnpm stryker`).** Breaks if fewer than 80% of injected bugs are caught. CI runs it in its own job.

Before you push: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm stryker`. CI also runs the e2e job, checks that `worker-configuration.d.ts` is current (`pnpm cf-typegen`) and dry-runs both deploys.

## Environments and deploying

`wrangler.jsonc` has three setups: the top level is local development, `env.preview` and `env.production` are deployed. GitHub Actions deploys a pull request to preview and a green `main` to production. [docs/deployment.md](docs/deployment.md) covers first-time Cloudflare setup, the domain, a smoke-test checklist and the accepted risks.

## Known limits

Short story IDs are guessable, the preview Worker is public, and the real Workers AI call has not been run end to end. These and the other accepted risks are listed in [docs/deployment.md](docs/deployment.md#accepted-risks), and what was only proven locally under [Proven only locally](docs/deployment.md#proven-only-locally).

## Licence

MIT. See [LICENSE](LICENSE).
