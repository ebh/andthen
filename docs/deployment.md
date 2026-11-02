# Deployment

The app is one Cloudflare Worker with static assets, a D1 database, a `StoryRoom` Durable Object and the Workers AI binding. `wrangler.jsonc` describes three setups. The Worker code is the same in all of them.

## Local, preview, production

|                  | Local                           | Preview                             | Production                             |
| ---------------- | ------------------------------- | ----------------------------------- | -------------------------------------- |
| `wrangler.jsonc` | top level                       | `env.preview`                       | `env.production`                       |
| Worker name      | `andthen-dev`                   | `andthen-preview`                   | `andthen`                              |
| Address          | `http://localhost:5173`         | `andthen-preview.<you>.workers.dev` | `https://app.andthen.page`             |
| D1               | local file in `.wrangler/state` | `andthen-preview`                   | `andthen-prod`                         |
| Suggestions      | `AI_PROVIDER=fake`              | `workers-ai`                        | `workers-ai`                           |
| Cookie           | `andthen_bt`, no `Secure`       | `__Host-andthen_bt`                 | `__Host-andthen_bt`                    |
| Deployed by      | nobody                          | `deploy.yml` on a pull request      | `deploy.yml` after CI passes on `main` |

- **The environment is chosen when you build**, not when you deploy. `CLOUDFLARE_ENV=preview pnpm build` bakes the preview config into `dist/andthen_dev/wrangler.json`, and `wrangler deploy` reads that file. A `--env` flag on `deploy` is accepted but changes nothing, so always set `CLOUDFLARE_ENV` for the build.
- **Migrations read `wrangler.jsonc` itself**, so they do take `--env`. Run them before building: the build leaves a redirect file (`.wrangler/deploy/config.json`) that points wrangler at the built config.
- **Preview is one shared Worker.** Every same-repo pull request deploys over the last one, and they all share the preview database. Treat it as a scratch space.

Dry runs (no login, nothing uploaded): `CLOUDFLARE_ENV=preview pnpm build && pnpm wrangler deploy --dry-run`, then the same with `production`. CI does both on every push.

## First-time Cloudflare setup

`andthen.page` is assumed to be registered through Cloudflare Registrar, so its zone is already on Cloudflare's nameservers. Registration and DNS can take a few minutes to show up in `dig` after purchase.

Run `wrangler` steps from a checkout, with `pnpm wrangler …`.

1. **Account.** Have a Cloudflare account on the Workers Free plan or better. Note the account ID (dashboard, right side of the Workers & Pages overview, or `pnpm wrangler whoami`).
2. **API token** for CI: dashboard, My Profile, API Tokens, Create Token, Custom token. Name it `andthen-github-actions`. Permissions:
   - Account, Workers Scripts, Edit
   - Account, D1, Edit
   - Account, Workers AI, Read (Edit also works; needed because the Worker binds `AI`)
   - Account, Account Settings, Read (wrangler reads the account's subdomain and name)
   - Zone, Workers Routes, Edit (the `app.andthen.page` custom domain)
   - Zone, DNS, Edit (wrangler creates the DNS record for the custom domain)
   - Zone, Zone, Read
   - Account resources: your account only. Zone resources: `andthen.page` only.
   - The apex redirect rule is a one-time step in the dashboard, so CI needs no rule permission. Add Zone, Single Redirect (or Zone Rulesets), Edit only if you create the rule through the API below with this same token.
3. **Databases.** Log in once on your laptop (`pnpm wrangler login`), then:
   ```sh
   pnpm wrangler d1 create andthen-preview
   pnpm wrangler d1 create andthen-prod
   ```
   Each prints a `database_id`, which belongs in `env.preview` and `env.production` in `wrangler.jsonc`. Database IDs are identifiers, not secrets: without an API token they grant nothing, so they are committed. A fork that deploys for itself replaces them with its own. The top-level ID (all zeros) is a stand-in for local development, which never reads it.
4. **GitHub secrets and environments.** In the repository settings:
   - Environments: create `preview` and `production`. Add protection rules where you want them. A required reviewer on `production` makes every deploy wait for you; restricting `production` to the `main` branch is a good minimum.
   - Secrets: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets on each environment (or once as repository secrets). Nothing else is needed, and no secret belongs in the repo.
   - Settings, Actions, General, Fork pull request workflows: leave "Require approval" on. `deploy.yml` also refuses to run for a fork, and forks never receive secrets.
5. **Workers AI budget.** Dashboard, Manage Account, Notifications, Add: pick the Workers AI usage (or billing) alert and set a threshold you are comfortable with. Suggestions are the only paid call, and nothing in the app stops someone from using up the quota (see "Accepted risks").

## The domain

The app lives on `app.andthen.page`. The bare `andthen.page` is left free for a later marketing page and, until then, redirects to the app.

- **`app.andthen.page`** is a Workers custom domain, declared in `env.production.routes`. The first production deploy creates its DNS record and certificate. Do not create an `app` DNS record yourself: wrangler refuses to take over an existing one.
- **`.page` is on the HSTS preload list**, so browsers refuse plain HTTP for every name under it. HTTPS is mandatory, which Cloudflare provides by default. Do not turn off "Always Use HTTPS" or try to serve anything over HTTP.

### Apex redirect: `andthen.page/*` to `https://app.andthen.page/<path>`

A redirect rule only runs for traffic that goes through Cloudflare's proxy, and the bare domain has no record yet. So first add a proxied placeholder, then the rule.

Dashboard steps:

1. `andthen.page`, DNS, Records, Add record: type `A`, name `@`, IPv4 `192.0.2.1`, proxy status **Proxied** (orange cloud). `192.0.2.1` is a reserved address that is never contacted, because the rule answers first. If you also want `www`, add a proxied `CNAME` `www` to `andthen.page`.
2. Rules, Redirect Rules, Create rule, "Custom filter expression":
   - Rule name: `apex to app`
   - When incoming requests match: field Hostname, operator equals, value `andthen.page` (expression `http.host eq "andthen.page"`)
   - Then: type **Dynamic**, expression `concat("https://app.andthen.page", http.request.uri.path)`, status code **301**, and tick **Preserve query string**
   - Deploy.
3. Check: `curl -sI "https://andthen.page/abc12?x=1"` returns `301` with `location: https://app.andthen.page/abc12?x=1`.

Optional, the same through the API (needs the extra token permission from step 2 of the setup; the token is read from your shell, never committed):

```sh
ZONE_ID=…   # dashboard, andthen.page overview, right side
curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_dynamic_redirect/entrypoint" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [{
      "description": "apex to app",
      "expression": "http.host eq \"andthen.page\"",
      "action": "redirect",
      "action_parameters": {
        "from_value": {
          "status_code": 301,
          "preserve_query_string": true,
          "target_url": { "expression": "concat(\"https://app.andthen.page\", http.request.uri.path)" }
        }
      }
    }]
  }'
```

This replaces the zone's whole redirect ruleset, so use the dashboard if you already have other redirect rules.

## First deploy, in order

1. Do the setup above: the databases, the API token, the GitHub environments and secrets.
2. Open the pull request. `deploy.yml` applies the migrations to `andthen-preview` and deploys `andthen-preview`. Its log prints the `workers.dev` URL.
3. Run the preview smoke test below.
4. Merge. CI runs on `main`; when it passes, `deploy.yml` migrates `andthen-prod` and deploys `andthen`, which also creates `app.andthen.page`. If you set a required reviewer on `production`, approve the deployment in the Actions run.
5. Add the apex redirect (above). Run the production smoke test.

To deploy by hand instead (first deploy from a laptop, or a rescue), after `pnpm wrangler login`:

```sh
pnpm wrangler d1 migrations apply DB --env preview --remote
CLOUDFLARE_ENV=preview pnpm build && pnpm wrangler deploy
```

Use `production` in both places for production.

A new D1 change is a new file in `migrations/`. `deploy.yml` applies it to the database before the Worker that needs it goes out, so write migrations that the previous Worker version can still run against.

## Smoke tests

Preview, on the `workers.dev` URL, with two browsers (or a normal and a private window):

- [ ] The home page loads over HTTPS and `/api/health` returns JSON.
- [ ] Window A creates a story. The URL becomes `/<5 characters>`, the opening passage shows, and the browser has the `__Host-andthen_bt` cookie.
- [ ] Window B opens the invite link, sees only the join form, joins, and gets the turn.
- [ ] Window A shows B's join without a reload (the live socket works through the edge).
- [ ] B writes a passage. A shows it without a reload, and the turn moves to A.
- [ ] B asks for suggestions on a later turn: three real suggestions appear and fill the composer, and nothing is sent. A fourth request in an hour shows the rate-limit message.
- [ ] With a third window, skip the turn holder.
- [ ] Reload every window: the story and the turn are unchanged.
- [ ] Leave a window open for a few minutes with nothing happening, then have the other window write. The idle window still updates (the Durable Object woke from hibernation).
- [ ] The Workers logs (dashboard, Workers, `andthen-preview`, Logs) show no `internal_error`.

Production, on `https://app.andthen.page`: repeat the list above, and also:

- [ ] `curl -sI https://andthen.page/abc12?x=1` is a 301 to `https://app.andthen.page/abc12?x=1`.
- [ ] `curl -sI http://app.andthen.page` ends on HTTPS.
- [ ] Look at the Workers AI usage page after the suggestions test, and check the budget alert exists.

## Trying the real model locally

`pnpm dev` uses the fake provider and needs no login. To call Workers AI from your machine, which can cost money:

```sh
pnpm wrangler login
echo 'AI_PROVIDER=workers-ai' >> .dev.vars    # .dev.vars is gitignored
AI_REMOTE=1 pnpm dev
```

`AI_REMOTE` must be a shell variable: `vite.config.ts` reads it to turn remote bindings on, and `.dev.vars` is read only by the Worker. Without it, the `AI` binding is never started and the Worker throws on `env.AI.run`. See `.dev.vars.example`.

## Accepted risks

These were chosen for the first release. None has a mitigation in the code.

- **Story IDs are guessable.** 5 characters from `[a-z0-9]` is about 60 million values, and the link is the only secret. A guessed ID can be joined, and a 403 versus a 404 tells a prober whether a story exists.
- **No rate limit on creating or joining stories.** Anyone can create stories or join them as fast as D1 allows, and every new cookie is a new participant. A Cloudflare rate-limiting rule on `POST /api/stories*` is the fix when it matters.
- **The suggestion quota is per cookie.** Someone who clears cookies and joins again gets 3 fresh requests. The Workers AI budget alert is the backstop.
- **A story holds at most 50 participants** (`MAX_PARTICIPANTS`), so a link that leaks cannot grow a story without bound, but it can still fill one.
- **`suggestion_requests` rows are never deleted.** The table grows by one row per suggestion request. Each is small, and D1's free storage is large, but it needs a cleanup job before heavy use.

## Proven only locally

Everything below passed against Miniflare, workerd or test doubles, never against Cloudflare. Check each on the real preview after the first deploy, and fix this page with what you find.

- **Workers AI.** The real output shape (`{response}` as an object or as JSON text), the `response_format: { type: "json_schema", … }` input, the exact `JSON Mode couldn't be met` error text, quota and rate-limit error shapes, latency against the 25 s timeout, and billing.
- **Story ID collision retry on real D1.** The code tells a collision from other failures by re-reading the row, not by the error text, because Miniflare and D1 word the error differently. A collision cannot be provoked by hand at this ID size, so this stays a code-reading check.
- **Durable Object hibernation and eviction.** Locally the object is never evicted. Confirm that an idle socket still gets a message after the object has been evicted, and that a reconnect refetches.
- **The `__Host-` cookie over real HTTPS.** Checked on `http://localhost` only, where the cookie has a different name and no `Secure`. Confirm that the cookie is set, kept and sent on `workers.dev` and on `app.andthen.page`, and that a second browser gets a different participant.
- **The live WebSocket through the real edge.** The upgrade, the 25 s ping, reconnects and the same-origin check on `Origin`, behind Cloudflare's proxy and, for production, the custom domain.
- **Custom domain and redirect.** The first `app.andthen.page` deploy, its certificate, and the apex 301.
