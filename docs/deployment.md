# Deployment

The app is one Cloudflare Worker with static assets, a D1 database, a `StoryRoom` Durable Object and the Workers AI binding. `wrangler.jsonc` describes three setups. The Worker code is the same in all of them.

## Local, preview, production

|                  | Local                           | Preview                                           | Production                             |
| ---------------- | ------------------------------- | ------------------------------------------------- | -------------------------------------- |
| `wrangler.jsonc` | top level                       | `env.preview`                                     | `env.production`                       |
| Worker name      | `andthen-dev`                   | `andthen-preview`                                 | `andthen`                              |
| Address          | `http://localhost:5173`         | `andthen-preview.<account-subdomain>.workers.dev` | `https://app.andthen.page`             |
| D1               | local file in `.wrangler/state` | `andthen-preview`                                 | `andthen-prod`                         |
| Suggestions      | `AI_PROVIDER=fake`              | `workers-ai`                                      | `workers-ai`                           |
| Cookie           | `andthen_bt`, no `Secure`       | `__Host-andthen_bt`                               | `__Host-andthen_bt`                    |
| Deployed by      | nobody                          | `deploy.yml` on a pull request                    | `deploy.yml` after CI passes on `main` |

- **The build is the same for every environment; the environment is chosen when you deploy.** `pnpm build` exports the Expo web app into `dist/`: the wrapped command `tamagui build --target web ./src/ui -- expo export --platform web --output-dir dist`. Plain `expo export` leaves the app unstyled, because only `tamagui build` writes the CSS. `wrangler.jsonc` points `assets.directory` at `dist/`, and `pnpm wrangler deploy --env preview` (or `production`) uploads it with the Worker. `/api/*` reaches the Worker first; any other path that is not a file in `dist/` gets `index.html`, and the app shows its not-found page.
- **Migrations take `--env` too.** `deploy.yml` runs them before the build and the deploy.
- **Local runs two servers behind one address.** `pnpm dev` (`scripts/dev.ts`) starts Metro (the Expo dev server) and `wrangler dev --local`, then proxies `localhost:5173`: `/api/*`, including the live WebSocket, goes to the Worker and everything else to Metro. One origin keeps the API's same-origin check and the cookie working. The compiler is off in dev, so styles come from the generated `tamagui.generated.css` of the last `pnpm build`; run it once on a fresh checkout. The e2e run is different: it builds, then serves `dist/` from `wrangler dev --local` on port 4173.
- **A leftover `.wrangler/deploy/config.json` breaks wrangler.** Builds of the earlier Vite client wrote it, and it points at a `dist/andthen_dev/wrangler.json` that no longer exists. Delete `.wrangler/deploy/` once if wrangler reports a missing redirected configuration.
- **Preview is one shared Worker.** Every same-repo pull request deploys over the last one, and they all share the preview database. Treat it as a scratch space.

- **Raising `MIN_API_LEVEL`** (in `src/shared/apiLevel.ts`) locks out clients below it: their next request gets 426 `client_outdated` and the app shows the update screen. The app and the Worker deploy together, so only a client that loaded the old app earlier is affected: an open tab or a cached copy, which the service worker keeps (see "Offline and updates"). On the update screen, "Update now" replaces the old app through the service worker, so the user does not have to clear anything. Preview is shared, so a raise there also locks out everyone using the preview until they reload.

Dry runs (no login, nothing uploaded): `pnpm build && pnpm wrangler deploy --dry-run --env preview`, then the same with `--env production`. CI does both on every push.

## Offline and updates

The app is installable and its pages load offline. A service worker, `dist/sw.js`, does this. `pnpm build` makes it after the Expo export: `scripts/buildServiceWorker.ts` bundles `src/serviceWorker/sw.ts` and fills in the list of files to precache. The page registers it in a production build only (`src/client/appUpdate.ts`), so `pnpm dev` has none.

- **What it caches.** The app shell: `index.html`, the hashed files under `_expo/static/` and the fonts. Any page address gets the cached `index.html`, except `/api/*`. Nothing else is cached at run time, so API calls, including the live socket, always go to the network.
- **How a new build reaches users.** A deploy changes `dist/sw.js`. The browser checks for it when a page becomes visible and once an hour, and installs it beside the old one. The new build then waits: it does not take over by itself, so a page never changes under a reader. The page shows "A new version is ready." with an "Update" button. Tapping it, or "Update now" on the update screen, tells the new build to take over, and the page reloads under it. If no build is waiting, or it does not take over within 10 seconds, the page removes the service worker and every cache and reloads from the network.
- **`/sw.js` must never be served stale.** Cloudflare serves static assets with `max-age=0, must-revalidate`, which is what a worker script needs. Do not add a `_headers` rule that caches it.
- **The single-page fallback hides a missing `/sw.js`.** A path that is not a file in `dist/` gets `index.html` with a 200, so without `dist/sw.js` the deploy looks healthy and browsers reject the registration only on the user's device. `buildServiceWorker.ts` therefore fails the build if `dist/sw.js` is missing or empty, or if the precache list lacks `index.html`, a file under `_expo/` or a font.
- **Fonts sit under a `.pnpm` folder.** Expo puts them in `assets/node_modules/.pnpm/…`. A `**` glob skips a folder whose name starts with a dot, so the precache pattern names `.pnpm` in full. The font check above fails the build if it stops matching.
- **Testing it.** `e2e/pwa.spec.ts` covers registration, offline loading, the API staying uncached and the update flow. The update test goes through `e2e/versionProxy.ts`, which swaps `/sw.js` to stand in for a deploy, because `wrangler dev` reads its asset list once at start.

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
   - The apex redirect rule is a one-time step in the dashboard, so CI needs no rule permission.
3. **Databases.** Log in once on your laptop (`pnpm wrangler login`), then:
   ```sh
   pnpm wrangler d1 create andthen-preview
   pnpm wrangler d1 create andthen-prod
   ```
   Each prints a `database_id`, which belongs in `env.preview` and `env.production` in `wrangler.jsonc`. Database IDs are identifiers, not secrets: without an API token they grant nothing, so they are committed. A fork that deploys for itself replaces them with its own. The top-level ID (all zeros) is a stand-in for local development, which never reads it.
4. **GitHub secrets and environments.** In the repository settings:
   - Environments: create `preview` and `production`. Add protection rules where you want them. A required reviewer on `production` makes every deploy wait for you; restricting `production` to the `main` branch is a good minimum.
   - Secrets: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as secrets of each environment, never as repository secrets. The `preview` job builds and runs code from a pull request while it holds the token, and the permissions above also cover the production database and Worker. An environment secret reaches only jobs that name that environment, so `preview` jobs never see the production one. Nothing else is needed, and no secret belongs in the repo.
   - Hardening, optional: give `preview` its own narrower token (for example without the zone permissions, which only production's custom domain needs), and add a deployment branch rule on `production` that allows only `main`.
   - Settings, Actions, General, Fork pull request workflows: leave "Require approval" on. `deploy.yml` also refuses to run for a fork, and forks never receive secrets.
5. **workers.dev subdomain.** The first preview deploy needs the account to have a `workers.dev` subdomain: dashboard, Workers & Pages, Subdomain. Preview is then served at `andthen-preview.<account-subdomain>.workers.dev`.
6. **Workers AI budget.** Not needed on the Free plan; set one if you upgrade (see "Accepted risks"). Dashboard, Manage Account, Notifications, Add: pick the Workers AI usage (or billing) alert and set a threshold you are comfortable with.

## The domain

The app lives on `app.andthen.page`. The bare `andthen.page` is left free for a later marketing page and, until then, redirects to the app.

- **`app.andthen.page`** is a Workers custom domain, declared in `env.production.routes`. The first production deploy creates its DNS record and certificate. Do not create an `app` DNS record yourself: wrangler refuses to take over an existing one.
- **`.page` is on the HSTS preload list**, so browsers refuse plain HTTP for every name under it. HTTPS is mandatory, which Cloudflare provides by default. Do not turn off "Always Use HTTPS" or try to serve anything over HTTP.

### Apex redirect: `andthen.page/*` to `https://app.andthen.page/<path>`

A redirect rule only runs for traffic that goes through Cloudflare's proxy, and the bare domain has no record yet. So first add a proxied placeholder, then the rule.

Dashboard steps:

1. `andthen.page`, DNS, Records, Add record: type `A`, name `@`, IPv4 `192.0.2.1`, proxy status **Proxied** (orange cloud). `192.0.2.1` is a reserved address that is never contacted, because the rule answers first.
2. Rules, Redirect Rules, Create rule, wildcard pattern:
   - Rule name: `apex to app`
   - Request URL: `https://andthen.page/*`
   - Target URL: `https://app.andthen.page/${1}`
   - Status code **301**, and tick **Preserve query string**
   - Deploy.
3. Check: `curl -sI "https://andthen.page/abc12?x=1"` returns `301` with `location: https://app.andthen.page/abc12?x=1`. A freshly created record can take a few minutes to resolve on your machine. To check against Cloudflare's resolver meanwhile, use `dig @1.1.1.1 andthen.page`, or `curl --resolve` with an address that `dig` returned.

## First deploy, in order

1. Do the setup above: the databases, the API token, the GitHub environments and secrets.
2. Open the pull request. `deploy.yml` applies the migrations to `andthen-preview` and deploys `andthen-preview`. Its log prints the `workers.dev` URL.
3. Run the preview smoke test below.
4. Merge. CI runs on `main`; when it passes, `deploy.yml` migrates `andthen-prod` and deploys `andthen`, which also creates `app.andthen.page`. If you set a required reviewer on `production`, approve the deployment in the Actions run.
5. Add the apex redirect (above). Run the production smoke test.

To deploy by hand instead (first deploy from a laptop, or a rescue), after `pnpm wrangler login`:

```sh
pnpm wrangler d1 migrations apply DB --env preview --remote
pnpm build && pnpm wrangler deploy --env preview
```

Use `production` in both places for production.

A new D1 change is a new file in `migrations/`. `deploy.yml` applies it to the database before the Worker that needs it goes out, so write migrations that the previous Worker version can still run against.

## Smoke tests

The app has only the start page and the not-found page so far. Until the story, join and your-stories pages return, do the first two items and check the rest against the API (`docs/api.md`).

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
- [ ] Look at the Workers AI usage page after the suggestions test. If the account is on a paid plan, check the budget alert exists; on the Free plan it is not needed.

Installed app, after the production smoke test, on a real Android phone (Chrome) and a real iPhone (Safari):

- [ ] Android Chrome: the browser offers "Install app", and the installed app opens full screen with the right name and icon.
- [ ] iPhone Safari: "Add to Home Screen" gives the right name and icon, and the app opens full screen.
- [ ] With the app open once, switch on airplane mode and reopen it: the start page loads, and a story link opens the app, which says the story is unavailable.
- [ ] After the next deploy, reopen the installed app: "A new version is ready." appears, "Update" reloads the app, and the notice does not return.
- [ ] After a deploy that raises `MIN_API_LEVEL`, an app opened from before it shows the update screen, and "Update now" brings the new version.

## Trying the real model locally

`pnpm dev` uses the fake provider and needs no login. To call Workers AI from your machine, which can cost money:

```sh
pnpm wrangler login
echo 'AI_PROVIDER=workers-ai' >> .dev.vars    # .dev.vars is gitignored
AI_REMOTE=1 pnpm dev
```

`AI_REMOTE` must be a shell variable: `scripts/dev.ts` reads it to leave out wrangler's `--local` flag, and `.dev.vars` is read only by the Worker. Without it, the `AI` binding is never started and the Worker throws on `env.AI.run`. See `.dev.vars.example`.

This path has not been run against the real model. The Workers AI call is covered only by tests with a stand-in; see "Proven only locally" below.

## Accepted risks

These were chosen for the first release. None has a mitigation in the code.

- **The preview Worker is public and uses real Workers AI.** Anyone who finds its `workers.dev` address can use it, and its suggestions are billed only on a paid plan; on the Free plan, requests fail past the allowance. It has its own database, so it cannot touch production stories.
- **Pull request code runs with the preview token.** A same-repo pull request can change `deploy.yml` or the build and so use the `preview` environment's secrets. That is why they must be environment secrets, and why the preview token should be narrow. Only people with write access can open such a pull request.
- **Story IDs are guessable.** 5 characters from `[a-z0-9]` is about 60 million values, and the link is the only secret. A guessed ID can be joined, and a 403 versus a 404 tells a prober whether a story exists.
- **No rate limit on creating or joining stories.** Anyone can create stories or join them as fast as D1 allows, and every new cookie is a new participant. A Cloudflare rate-limiting rule on `POST /api/stories*` is the fix when it matters.
- **The suggestion quota is per cookie.** Someone who clears cookies and joins again gets 3 fresh requests. On the Free plan, requests fail past the allowance; see "Cost exposure depends on the Cloudflare plan" below.
- **Cost exposure depends on the Cloudflare plan.** The account runs on the Free plan (check the plan under Workers & Pages, Plans in the dashboard). Past the daily or monthly allowances of Workers, D1, Durable Objects and Workers AI, requests fail instead of being billed, so the app can stop working but cannot produce a bill. A failed suggestion shows "suggestions unavailable". Cloudflare offers no hard spending cap on paid plans, only notifications, so moving to a paid plan removes this protection. Before doing so, add a global daily cap on suggestion requests, because the per-participant limit (3 per hour) can be bypassed by clearing cookies.
- **A browser's list of stories is unbounded.** `GET /api/stories` returns every story the cookie is in, and nothing limits how many a browser can start (see "No rate limit on creating or joining stories"). Each home page load reads them all. Paging is the fix when it matters.
- **Clearing cookies loses every story at once.** There are no accounts: the cookie is the only link between a writer and their stories, and it is HttpOnly, so it can't be exported or restored. The stories stay, and the writer can only come back as a new participant through an invite link.
- **A story with no writers left is on no one's list.** Leaving keeps the story open to anyone with its link, but nobody's list shows it, so only someone holding the link can reach it. A writer who left can still get back through the link they used.
- **A story holds at most 50 participants** (`MAX_PARTICIPANTS`), so a link that leaks cannot grow a story without bound, but it can still fill one. Only writers still in the story count, so a leaver frees a place.
- **`suggestion_requests` rows are never deleted.** The table grows by one row per suggestion request. Each is small, and D1's free storage is large, but it needs a cleanup job before heavy use.

## Proven only locally

Everything below passed against Miniflare, workerd or test doubles, never against Cloudflare. Check each on the real preview after the first deploy, and fix this page with what you find.

- **Workers AI.** The real output shape (`{response}` as an object or as JSON text), the `response_format: { type: "json_schema", … }` input, the exact `JSON Mode couldn't be met` error text, quota and rate-limit error shapes, latency against the 25 s timeout, and billing.
- **Story ID collision retry on real D1.** The code tells a collision from other failures by re-reading the row, not by the error text, because Miniflare and D1 word the error differently. A collision cannot be provoked by hand at this ID size, so this stays a code-reading check.
- **Durable Object hibernation and eviction.** Locally the object is never evicted. Confirm that an idle socket still gets a message after the object has been evicted, and that a reconnect refetches.
- **The `__Host-` cookie over real HTTPS.** Checked on `http://localhost` only, where the cookie has a different name and no `Secure`. Confirm that the cookie is set, kept and sent on `workers.dev` and on `app.andthen.page`, and that a second browser gets a different participant.
- **The live WebSocket through the real edge.** The upgrade, the 25 s ping, reconnects and the same-origin check on `Origin`, behind Cloudflare's proxy and, for production, the custom domain.
- **Custom domain and redirect.** The first `app.andthen.page` deploy, its certificate, and the apex 301.
- **The service worker on real devices.** Registration, install prompts, offline loading and the update flow were tested in Chromium against `wrangler dev` only. Safari and Firefox behaviour, the install prompt, and Cloudflare's `max-age=0, must-revalidate` on `/sw.js` need the smoke tests above on the real preview.
