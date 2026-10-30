# andthen.page

A group writes a story together, one passage each, in turns.

## Run it locally

Needs [fnm](https://github.com/Schniz/fnm) and pnpm 12.

```sh
fnm install            # Node version from .node-version
fnm use
npm install -g pnpm@12.16.1
pnpm install
pnpm db:migrate:local  # create the local D1 tables
pnpm dev               # http://localhost:5173
```

No Cloudflare login is needed. Local dev uses a local D1, a local Durable Object and fake AI suggestions. Copy `.dev.vars.example` to `.dev.vars` to override variables.

## Checks

| Command           | Does                                                           |
| ----------------- | -------------------------------------------------------------- |
| `pnpm format`     | Formats with oxfmt (`format:check` only checks).               |
| `pnpm lint`       | oxlint (type-aware), then ESLint for the rules oxlint lacks.   |
| `pnpm typecheck`  | `tsc -b` over client, Worker and tooling projects.             |
| `pnpm test`       | Vitest: unit tests and Miniflare-backed integration tests.     |
| `pnpm stryker`    | Mutation tests over `src/shared` and `src/worker`.             |
| `pnpm build`      | Typecheck, then build the SPA and Worker into `dist/`.         |
| `pnpm cf-typegen` | Regenerates `worker-configuration.d.ts` from `wrangler.jsonc`. |

## Environments

`wrangler.jsonc` has three: the top level is local dev, `env.preview` and `env.production`. Build one with `CLOUDFLARE_ENV=preview pnpm build`, then `pnpm wrangler deploy --dry-run` to check it. Deploying is set up in a later phase.
