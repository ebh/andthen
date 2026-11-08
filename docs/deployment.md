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
| Clerk instance   | development                     | development                                       | production                             |
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

- **What it caches.** The app shell: `index.html`, the hashed files under `_expo/static/`, the fonts and the two tab icons (`icon.svg`, `favicon.ico`). Any page address gets the cached `index.html`, except `/api/*`. Nothing else is cached at run time, so API calls, including the live socket, always go to the network.
- **How a new build reaches users.** A deploy changes `dist/sw.js`. The browser checks for it when a page becomes visible and once an hour, and installs it beside the old one. The new build then waits: it does not take over by itself, so a page never changes under a reader. The page shows "A new version is ready." with an "Update" button. Tapping it, or "Update now" on the update screen, tells the new build to take over, and the page reloads under it. If no build is waiting, or it does not take over within 10 seconds, the page removes the service worker and every cache and reloads from the network.
- **`/sw.js` must never be served stale.** Cloudflare serves static assets with `max-age=0, must-revalidate`, which is what a worker script needs. Do not add a `_headers` rule that caches it.
- **The single-page fallback hides a missing `/sw.js`.** A path that is not a file in `dist/` gets `index.html` with a 200, so without `dist/sw.js` the deploy looks healthy and browsers reject the registration only on the user's device. `buildServiceWorker.ts` therefore fails the build if `dist/sw.js` is missing or empty, or if the precache list lacks `index.html`, a file under `_expo/` or a font.
- **The same worker shows "your turn" notifications.** `src/serviceWorker/sw.ts` also handles `push` and `notificationclick` (logic in `src/client/pushHandlers.ts`). The "Notify me when it's my turn" switch needs this worker registered, so it exists only in a production build. iOS and iPadOS need the app added to the Home Screen first (iOS 16.4 or later); in a browser tab there the page shows a hint instead. See "Web Push" in `docs/api.md`.
- **Fonts sit under a `.pnpm` folder.** Expo puts them in `assets/node_modules/.pnpm/…`. A `**` glob skips a folder whose name starts with a dot, so the precache pattern names `.pnpm` in full. The font check above fails the build if it stops matching.
- **The icons are placeholders.** `public/` holds `icon.svg` (the source and the SVG favicon), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` and `favicon.ico`. The final art replaces these files under the same names, with no code change. The store apps have their own placeholders in `assets/` (see "Native builds").
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

## Web Push keys

"Your turn" notifications are signed with a VAPID key pair (RFC 8292). Each environment has its own pair, so a leak in preview cannot send as production. The public key is a plain var in `wrangler.jsonc` (`VAPID_PUBLIC_KEY`, set under each environment because `vars` do not inherit). The private key is a Worker secret (`VAPID_PRIVATE_KEY`) and never goes in the repo.

Make a pair, print it and keep the private line out of shell history and logs:

```sh
pnpm vapid-keys
```

Then, for each of `preview` and `production`:

1. Put the `VAPID_PUBLIC_KEY` line's value in that environment's `vars` in `wrangler.jsonc`.
2. Store the private key, pasting it at the prompt: `pnpm wrangler secret put VAPID_PRIVATE_KEY --env preview` (or `production`).
3. Run `pnpm cf-typegen` and commit `worker-configuration.d.ts` if it changed. Run it without a `.dev.vars` file, or the secret would be written into the generated types and CI's `wrangler types --check` would fail.

- **Set the secret before the Worker with the push code deploys.** Without it nothing crashes: the key route and every story route keep working, and each push that would be sent is skipped with a "Turn push failed" error in the logs that names `VAPID_PRIVATE_KEY`. But no one is notified until the secret is set. `wrangler secret put` on an environment whose Worker does not exist yet offers to create it.
- **The public and private key must be a pair.** A mismatch is not detected here: the push service rejects the signature (usually 401 or 403) and the Worker logs `Push to <host> answered <status>`. Change both together.
- **Changing a key** invalidates every stored subscription, because browsers bind a subscription to the public key they subscribed with. The routes need no change, but each browser must subscribe again. Rotate only when the private key leaks.
- **Local.** `wrangler.jsonc` carries a public key for `pnpm dev` whose private half is not kept, so the "your turn" push is skipped locally and logs why. To receive a real push locally, run `pnpm vapid-keys` and put both lines in `.dev.vars` (see `.dev.vars.example`); `.dev.vars` overrides the var in `wrangler.jsonc`. Browsers only accept a push service from a secure origin, which includes `http://localhost`.

## Clerk accounts

Accounts are optional and come from Clerk. The app works without one, and a fresh clone needs no Clerk setup. Two Clerk instances serve the three setups: the development instance serves local and preview, and the production instance serves `app.andthen.page`. No Clerk secret key is used anywhere.

Where each key lives:

- **Development publishable key:** committed in `.env` as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>`. Expo reads it for `pnpm dev`, the CI build, the e2e run and the preview deploy. A publishable key is public: it only names the instance.
- **Production publishable key:** the variable `CLERK_PUBLISHABLE_KEY` on the GitHub `production` environment. It is a variable, not a secret. The production Build step in `.github/workflows/deploy.yml` passes it as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, which beats `.env`. An empty value beats `.env` too, and the app then throws on every load, so the step fails the build when the variable is empty.
- **Instance public key:** `CLERK_JWT_KEY` in the `vars` of `wrangler.jsonc`, a public key in PEM form that the Worker uses to check session tokens without a network call. The development key is in the local and preview blocks. The production block holds the production instance's key.
- **Wrangler reads `.env`.** `pnpm cf-typegen` and `wrangler dev` read the committed `.env`, so `worker-configuration.d.ts` lists `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` as a Worker var. That does no harm, because the key is public. This is how it works today; whether to change it is undecided.

First-time Clerk setup:

1. **Create the application** in the Clerk dashboard, with a development and a production instance.
2. **Keep email verification on** for sign-up.
3. **Production DNS.** Add the DNS records the production instance lists for `andthen.page`, each as DNS-only (grey cloud), not proxied.
4. **GitHub variable.** Set `CLERK_PUBLISHABLE_KEY` to the production instance's publishable key, on the `production` environment.
5. **Instance public keys.** The dashboard shows no "Show JWT public key" button. Fetch `/.well-known/jwks.json` from the instance's Frontend API domain and convert its RSA key to a PEM. In Node, `crypto.createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "pem" })` does it, where `jwk` is the entry of the `keys` array. Put the PEM in `CLERK_JWT_KEY`, with newlines written as `\n`, in the production block of `wrangler.jsonc`. The key must be an RSA-2048 key in SPKI form (`-----BEGIN PUBLIC KEY-----`).
6. **Regenerate the types.** Run `pnpm cf-typegen` and commit `worker-configuration.d.ts` if it changed.

Sign-ups from a clone land in the development instance, which the project owns.

## Native builds

The iOS and Android apps are built with [EAS Build](https://docs.expo.dev/build/introduction/). Run with `--local`, the build happens on your machine or a GitHub Actions runner, which is free for a public repository and does not use Expo's monthly allowance of cloud builds. It still needs a free Expo account, because EAS keeps the build numbers. `app.json` holds the app's identity and `eas.json` holds the build profiles. The app ID is `page.andthen.app` on both platforms. It is permanent once a build reaches a store, so do not change it after that.

| Profile       | Builds                                                   | Needs                               |
| ------------- | -------------------------------------------------------- | ----------------------------------- |
| `development` | Development client for the iOS simulator and Android APK | Expo account                        |
| `preview`     | iOS simulator build and Android APK, shared by link      | Expo account                        |
| `production`  | Store builds; EAS raises the build number on each build  | Apple and Google developer accounts |

- **Versions.** `version` in `app.json` is the user-facing version. The iOS build number and Android version code live on EAS (`appVersionSource: "remote"`), and the `production` profile raises them on every build. Never edit them in a file.
- **Targets.** React Native 0.88 sets Android `targetSdkVersion` 36, which meets Google Play's target API level. iOS builds use the `auto` image, which for Expo SDK 58 is Xcode 27.1, so the iOS 26 SDK minimum is met. Check both when upgrading Expo. Do not pin an image in `eas.json`.
- **Pinned tools.** `eas.json` pins the Node and pnpm versions to `engines` and `packageManager` in `package.json`. The EAS CLI is a dev dependency, so run it as `pnpm eas …`; never install it globally.
- **Generated CSS.** The root layout imports `tamagui.generated.css`, which `pnpm build` writes and git ignores, so a cloud build has none. The `eas-build-post-install` script in `package.json` creates an empty file (`scripts/ensureGeneratedCss.ts`). Native ignores CSS.
- **Placeholder art.** `assets/icon.png`, `assets/adaptive-icon.png` and `assets/splash-icon.png` are rendered from `public/icon.svg`. The final art replaces them under the same names. Keep the adaptive icon's glyph inside the centre 66%, because Android masks the rest.
- **Sign in with Apple.** The `@clerk/expo` plugin adds the Sign in with Apple entitlement to the iOS app. A build for a real iPhone therefore needs an App ID with that capability. The simulator build does not.

Environment variables are set on EAS (`pnpm eas env:set`), one value per environment, and chosen by the profile's `environment` field. Expo inlines `EXPO_PUBLIC_*` values into the JavaScript bundle at build time.

| Variable                            | Value                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_ORIGIN`            | The Worker's origin, such as `https://app.andthen.page`, with no path. Nothing reads it yet. |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | The Clerk key for that environment. Development and preview use the key in `.env`.           |

### Make a preview build from a clean clone

1. Install as in the README, then log in to an Expo account: `pnpm eas login`.
2. Link the project once: `pnpm eas init`. It writes `extra.eas.projectId` into `app.json`, and `owner` when the project belongs to a team. A fork links its own project and replaces the ID.
3. Add the variables above to the `preview` environment: `pnpm eas env:set preview --name <NAME> --value <VALUE> --visibility plaintext`.
4. Build: `pnpm eas build --local --profile preview --platform ios` (or `android`). A local build needs the platform's toolchain: Xcode and CocoaPods for iOS, the Android SDK and a JDK for Android. Leave out `--local` to build on Expo's servers instead, which counts against the free allowance.
5. Install it.
   - iOS: unpack the `.tar.gz` the build wrote (or downloaded from the build page) and run `xcrun simctl install booted <path to .app>` on a booted simulator.
   - Android: copy the APK to the phone and open it, or run `adb install <file.apk>`.

Until [#100](https://github.com/ebh/andthen/issues/100) the app has browser-only code and relative API paths. A preview build installs, but it may not start or reach the Worker.

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

1. Do the setup above: the databases, the API token, the GitHub environments and secrets, the Web Push keys (the `VAPID_PRIVATE_KEY` secret of each environment) and the Clerk setup (the production instance, the `CLERK_PUBLISHABLE_KEY` variable and the production `CLERK_JWT_KEY`).
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

A new D1 change is a new file in `migrations/`. `deploy.yml` applies it to the database before the Worker that needs it goes out, so write migrations that the previous Worker version can still run against. `0005_users.sql` is the one exception; see "Accepted risks".

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
- [ ] `GET /api/push-subscription/key` returns the environment's `VAPID_PUBLIC_KEY`. Then, with a real subscription (the notification setup in the app, once it ships, or `PUT /api/push-subscription` from a browser console), have another window pass the turn to the subscribed one: the push arrives, and the Workers logs show no "Turn push failed" or `Push to … answered` line.
- [ ] Reload every window: the story and the turn are unchanged.
- [ ] Sign in with an email from the home page ("Sign in"). The stories started before signing in are still listed, and a second browser signed in to the same account lists them too. Sign out: the list is empty again.
- [ ] Leave a window open for a few minutes with nothing happening, then have the other window write. The idle window still updates (the Durable Object woke from hibernation).
- [ ] The Workers logs (dashboard, Workers, `andthen-preview`, Logs) show no `internal_error`.

Production, on `https://app.andthen.page`: repeat the list above, and also:

- [ ] `curl -sI https://andthen.page/abc12?x=1` is a 301 to `https://app.andthen.page/abc12?x=1`.
- [ ] `curl -sI http://app.andthen.page` ends on HTTPS.
- [ ] Look at the Workers AI usage page after the suggestions test. If the account is on a paid plan, check the budget alert exists; on the Free plan it is not needed.

Installed app, after the production smoke test, on a real Android phone (Chrome) and a real iPhone (Safari):

- [ ] Android Chrome: the browser offers "Install app", and the installed app opens full screen with the right name and icon.
- [ ] iPhone Safari: "Add to Home Screen" gives the right name and icon, and the app opens full screen.
- [ ] With the app open once, switch on airplane mode and reopen it: the start page loads, and an invite link opens the app, which says the story is unavailable.
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
- **The suggestion quota is per participant.** Someone who clears cookies and joins again gets 3 fresh requests. On the Free plan, requests fail past the allowance; see "Cost exposure depends on the Cloudflare plan" below.
- **Cost exposure depends on the Cloudflare plan.** The account runs on the Free plan (check the plan under Workers & Pages, Plans in the dashboard). Past the daily or monthly allowances of Workers, D1, Durable Objects and Workers AI, requests fail instead of being billed, so the app can stop working but cannot produce a bill. A failed suggestion shows "suggestions unavailable". Cloudflare offers no hard spending cap on paid plans, only notifications, so moving to a paid plan removes this protection. Before doing so, add a global daily cap on suggestion requests, because the per-participant limit (3 per hour) can be bypassed by clearing cookies.
- **A user's list of stories is unbounded.** `GET /api/stories` returns every story the user is in, and nothing limits how many a user can start (see "No rate limit on creating or joining stories"). Each home page load reads them all. Paging is the fix when it matters.
- **Clearing cookies loses an anonymous user's stories at once.** The cookie is the only link between an anonymous user and their stories, and it is HttpOnly, so it can't be exported or restored. The stories stay, and the writer can only come back as a new participant through an invite link. A user who signs in first keeps their stories, because the account, not the cookie, names them.
- **Migration `0005_users.sql` breaks the rule that a migration works with the previous Worker.** It rebuilds `participants` and `push_subscriptions` around a new `users` table. Between the migration and the Worker deploy, the old Worker fails on its first query of those tables. That lasts the seconds the deploy takes. Other open pull requests' previews break the same way until they rebase onto this change and redeploy.
- **Preview uses the Clerk development instance, which allows 100 users.** Sign-ups past that fail. Delete test users in the Clerk dashboard when it fills.
- **Sessions last 7 days on Clerk's Hobby plan.** A signed-in user must sign in again after that, whatever the app does.
- **A story with no writers left is on no one's list.** Leaving keeps the story open to anyone with its link, but nobody's list shows it, so only someone holding the link can reach it. A writer who left can still get back through the link they used.
- **A story holds at most 50 participants** (`MAX_PARTICIPANTS`), so a link that leaks cannot grow a story without bound, but it can still fill one. Only writers still in the story count, so a leaver frees a place.
- **Nothing limits how many push endpoints one user registers.** `PUT /api/push-subscription` accepts only endpoints on the known push service hosts (`isPushServiceEndpoint` in `src/shared/api.ts`), so the Worker cannot be pointed at other sites. But a user can still store any number of endpoints on those hosts, and each is posted to when that user is handed the turn. A rate limit on the route, or a cap per user, is the fix when it matters.
- **"Update now" switches notifications off.** When no waiting build can take over, the update screen's fallback unregisters the service worker, and that drops the browser's push subscription. The load that follows re-checks, finds none and shows the switch off, so the user has to switch it on again. The Worker keeps its row until a push to it answers 404 or 410. Nothing in the code works around this.
- **A push can be lost without the app knowing.** A push service that fails or rejects a message is logged and not retried. The page still shows the turn on the next visit.
- **A story mid-turn when the alarm code deploys gets no timer until its next write.** The room arms its alarm only when a write notifies it, so a turn already running at deploy time lapses without a push. After that write the story is covered. There is no backfill.
- **`suggestion_requests` rows are never deleted.** The table grows by one row per suggestion request. Each is small, and D1's free storage is large, but it needs a cleanup job before heavy use.
- **`/api/health` runs a D1 query for any caller.** It is exempt from the request guards so a monitor works, which also lets anyone spend D1 reads on it. Review its cost and exposure before real traffic.
- **Native apps cannot write yet.** `requireSameOrigin` rejects a request with no `Origin` header (see `docs/api.md`), and iOS and Android `fetch` and `WebSocket` send none. A native app can neither write nor go live until the Worker accepts a second credential. This comes from reading the code, not from a device run.

## Proven only locally

Everything below passed against Miniflare, workerd or test doubles, never against Cloudflare. Check each on the real preview after the first deploy, and fix this page with what you find.

- **Workers AI.** The real output shape (`{response}` as an object or as JSON text), the `response_format: { type: "json_schema", … }` input, the exact `JSON Mode couldn't be met` error text, quota and rate-limit error shapes, latency against the 25 s timeout, and billing.
- **Web Push through real push services.** The encryption and VAPID signing are tested against the real library in Node, and it was run once in local workerd without `nodejs_compat`, but no message has been delivered to a real push service. Check on preview that FCM (Chrome), Mozilla and Apple accept the signature, that a 404 or 410 really removes the subscription, and that `TTL`, `Topic` and `Urgency` are honoured.
- **The turn timeout alarm on Cloudflare.** Locally, workerd fires the alarm and `this.env.DB` works inside it. Not checked on the real platform: that an alarm set to a deadline 24 hours away survives eviction and fires on time, that a write's `setAlarm` replaces the earlier one, that a thrown alarm is retried, and that the timeout push reaches a real device. Check on preview with a story whose turn lapses (shorten `TURN_WINDOW_MS` in a throwaway build).
- **Story ID collision retry on real D1.** The code tells a collision from other failures by re-reading the row, not by the error text, because Miniflare and D1 word the error differently. A collision cannot be provoked by hand at this ID size, so this stays a code-reading check.
- **Durable Object hibernation and eviction.** Locally the object is never evicted. Confirm that an idle socket still gets a message after the object has been evicted, and that a reconnect refetches.
- **The `__Host-` cookie over real HTTPS.** Checked on `http://localhost` only, where the cookie has a different name and no `Secure`. Confirm that the cookie is set, kept and sent on `workers.dev` and on `app.andthen.page`, and that a second browser gets a different participant.
- **The live WebSocket through the real edge.** The upgrade, the 25 s ping, reconnects and the same-origin check on `Origin`, behind Cloudflare's proxy and, for production, the custom domain.
- **Custom domain and redirect.** The first `app.andthen.page` deploy, its certificate, and the apex 301.
- **Notifications on real devices.** The switch, the key, `PUT` and `DELETE` were run against `wrangler dev` in headless Chromium with a stand-in for the browser's push service (`e2e/turnAlerts.spec.ts`), because headless Chromium reports notifications as denied and has no push service. Never checked on a real browser or phone: the permission prompt, a real `subscribe` (including Brave with its Google push setting off), a notification appearing from the service worker's `push` handler, a tap focusing or opening the story, and Safari's declarative push alongside the `push` handler (the notification's `tag` is meant to stop a second copy, untested). On iOS, check that the Home Screen app offers the switch and that the permission prompt appears from the tap.
- **The service worker on real devices.** Registration, install prompts, offline loading and the update flow were tested in Chromium against `wrangler dev` only. Safari and Firefox behaviour, the install prompt, and Cloudflare's `max-age=0, must-revalidate` on `/sw.js` need the smoke tests above on the real preview.
- **Native builds.** The iOS and Android JavaScript bundles and the generated native projects were built locally, and the Android target and iOS deployment target were read from them. Not run: the `production` profile, a build for a real iPhone (needs an Apple Developer account), a Play-signed build, and whether an installed preview build starts.
- **Sign-in on the deployed apps.** Sign-in, session token checks and the merge ran locally against the development instance and with test-signed tokens. Not checked: sign-in on the preview address, and anything against the production instance. Check that Clerk accepts `app.andthen.page` as an origin and that a real token's `azp` equals it.
