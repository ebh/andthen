# Story API

Routes live in `src/worker/routes/stories.ts`, SQL in `src/worker/db/storyRepo.ts`. Request and response shapes are in `src/shared/api.ts`. `docs/turn-persistence.md` says how turn state is saved.

## Routes

| Route                                 | Success                        | Notes                                                                                       |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /api/stories`                    | 200 `{stories: [...]}`         | The stories this browser is in and has not left. See "Your stories".                        |
| `POST /api/stories`                   | 201 `{storyId}`                | Sets the cookie if the browser has none. A browser may start many stories under one cookie. |
| `GET /api/stories/:id`                | 200 `StoryView`                | 404 unknown ID, then 403 `not_participant` or `left_story`. Turn from `resolveTurn`.        |
| `POST /api/stories/:id/participants`  | 201 `{participantId}`          | Sets the cookie if the browser has none.                                                    |
| `POST /api/stories/:id/contributions` | 204                            | Body `{text, turnVersion, startsParagraph}`. The opening passage always starts a paragraph. |
| `POST /api/stories/:id/skip`          | 204                            | Body `{turnVersion}`.                                                                       |
| `POST /api/stories/:id/leave`         | 204                            | Body `{}`. See "Leaving and rejoining".                                                     |
| `POST /api/stories/:id/rejoin`        | 204                            | Body `{}`. Only for a browser that left. See "Leaving and rejoining".                       |
| `POST /api/stories/:id/suggestions`   | 200 `{suggestions: [s, s, s]}` | Turn holder only. No body needed. See "Suggestions".                                        |
| `GET /api/stories/:id/live`           | 101 (WebSocket)                | Participants only. See "Live updates".                                                      |

Mutating routes send no body back, except suggestions, which is a read. Clients refetch `GET /api/stories/:id`; the live socket tells them when.

## Error statuses

One status per code, in `ERROR_STATUS` in `src/worker/http.ts` (a `Record<ErrorCode, …>`, so a new code can't be forgotten).

- **400:** `bad_request`, `invalid_passage`, `invalid_display_name`.
- **403:** `forbidden_origin`, `not_participant`, `left_story`, `not_your_turn`, `cannot_skip_self`.
- **404:** `not_found`. An ID that can't be a story ID is also 404, with no database call. An unknown `/api/*` path is a JSON 404 too.
- **409:** `stale_turn`, `name_taken`, `already_joined`, `story_full`, `no_one_to_skip_to`.
- **429:** `ai_rate_limited`. **503:** `ai_unavailable`. Both come from the suggestions route.
- **413:** `payload_too_large`, a body over `MAX_BODY_BYTES` (8 KB), refused before it is parsed.
- **500:** `internal_error`, anything unexpected, logged with `console.error`.

Every error body is JSON `{error: <code>}`, so a client can parse it with `errorBodySchema`. The one exception is `left_story`, whose body also carries `displayName` and `opening` (see "Leaving and rejoining"). Every `/api/*` response carries `Cache-Control: no-store` (except a WebSocket upgrade).

- **426:** `client_outdated`, an `X-Api-Level` below the Worker's minimum. See "Versioning". A live upgrade without `Upgrade: websocket` is also 426, with a different body.

Order of checks on a mutating route: API level (400 malformed, 426 too low), Origin (403), Content-Type (400), body size (413), ID shape (404), JSON and shape (400), story exists (404), caller is a participant (403; 403 `left_story` for one who left), content validation (400), turn rules (403/409), guarded write (409).

## Things a client or reviewer might not expect

- **Story existence leaks.** An unknown ID is 404 and a known story you aren't in is 403, so anyone can probe whether a story exists. This is an accepted risk of short story IDs; see "Accepted risks" in `deployment.md`.
- **Taken names leak.** A join to a story you aren't in answers `name_taken` for a name in use, so a link holder can learn the participants' names (a name can't be checked without joining).
- **Body parsing comes before the story lookup.** A malformed body is 400 even for a story that doesn't exist or that you aren't in.
- **A rejected join still sets the cookie.** A browser with no cookie gets one before the join is checked, and keeps it after a `name_taken` or `stale_turn`. It is harmless: the token belongs to no participant until a join succeeds, and a retry with another name reuses it.
- **A waiting story answers contribute and skip differently.** A contribution is 403 `not_your_turn` (nobody holds the turn); a skip is 409 `stale_turn` (the page showed a turn that is gone).
- **Plain cookie only on `http://localhost`.** `127.0.0.1` and LAN hosts get the `__Host-` Secure cookie, which browsers drop over plain HTTP, so dev must use `localhost`.

## Your stories

`GET /api/stories` lists the stories whose participant rows carry the cookie's token hash and have no `left_at`, using the `participants_by_browser` index. It only reads: no cookie is issued, and a browser with none gets `{stories: []}`.

- **Entry:** `id`, `opening` (the first passage in full), `holderName` (null while the story waits), `isMyTurn`, `endsAt` (null while it waits) and `writerCount` (writers still in the story).
- **Turn:** `resolveTurn(state, now)`, as in the story view, so an expired turn shows its new holder. Nothing is written.
- **Order:** stories where the caller holds the turn first, then the newest passage first, then ID, so the order is stable between requests.
- **One snapshot:** the story rows, their writers and their first passages come from one `db.batch()`.
- **Not bounded:** nothing limits how many stories a browser can start, so nothing limits the list. See "Accepted risks" in `deployment.md`.

## Leaving and rejoining

Leaving is soft. `POST /api/stories/:id/leave` sets `participants.left_at` and keeps the row, because passages join to their author and a name stays reserved in its story.

- **Turn:** `onLeave` takes the position out of the rotation and bumps the version. If the leaver held the turn it passes to the next eligible writer with a fresh window. If nobody else is eligible (the leaver was alone, or the one writer left wrote last) the story waits. A story with no writers left stays open: anyone with the link can join and take the turn.
- **After leaving:** every route that needs a participant answers 403 `left_story` with `{error, displayName, opening}`: the name the writer had there and the story's opening, so the page can offer "Rejoin as <name>". A second leave is the same. The join route still answers `already_joined`, because the old name and cookie stay on the row, so a leaver gets back only through rejoin.
- **Names:** a leaver's name stays taken in that story, so a new joiner can't reuse it.
- **Rejoin:** `POST /api/stories/:id/rejoin` clears `left_at` and gives the row the position at the end of the rotation (`LoadedStory.nextPosition`, one past the highest position ever held, a leaver's included, so it never collides with the unique `(story_id, position)`). `onRejoin` keeps a writer who wrote last as the last contributor under their new position, so coming back never earns two turns in a row, and a waiting story stays waiting for them. 403 `not_participant` for a browser that was never in the story, 409 `already_joined` for one that is in it, 409 `story_full` when the story filled while they were away.
- **Races:** both routes are guarded by the loaded `turn_version` like every write, so one that loses a race answers 409 `stale_turn`.
- **Body:** `{}` and nothing else; a body with anything in it is 400 `bad_request` (`emptyRequestSchema`).

## Participant cap

A story holds at most `MAX_PARTICIPANTS` (50, creator included), because anyone with the link can join and each joiner can hold the turn for 24 hours. Only writers who are still in the story count: one who left frees their place. A join to a full story is 409 `story_full`, and so is a rejoin. Creating a story and reading it are not affected.

- **Which error wins:** `already_joined`, then `name_taken`, then `story_full`. A duplicate name or a repeat join on a full story keeps its own code. Only a join that would otherwise succeed gets `story_full`.
- **The version guard already serialises joins.** Every join bumps `turn_version`, so of two joins racing at 49 only one passes the `turn_version` guard (see "Writes and races").
- **The count guard is a second defence in the write.** The join `INSERT` and the rejoin `UPDATE` also need `(SELECT COUNT(*) FROM participants WHERE story_id = ? AND left_at IS NULL) < MAX_PARTICIPANTS`, so a call with a current version still can't add a 51st. The turn `UPDATE` needs the participant to be in the story (the row exists and `left_at` is null), so a refused insert or rejoin never moves the turn.
- **A refused write is explained by a re-read.** When `addParticipant` or `rejoinStory` returns false, the route reloads the story: 50 participants is `story_full`, anything else is `stale_turn`. Two joins racing at 49 therefore end as one 201 and one `story_full`.
- A refused join writes nothing, bumps no `turnVersion` and sends no live message.

## Guards

- **API level, on every `/api/*` request:** see "Versioning". It runs first, so a stale client gets `client_outdated` whatever else is wrong with its request.
- **On a mutating request:** `Origin` must equal the request's own origin; a missing `Origin` fails. `GET`, `HEAD` and `OPTIONS` are exempt. The live upgrade is a `GET` but runs the same check (`requireSameOrigin`).
- **On a mutating request:** `Content-Type` must be `application/json`, parameters allowed.

## Versioning

The API level is a whole number, `API_LEVEL` in `src/shared/apiLevel.ts`. It is bumped by hand, and only for a change that breaks a client that already shipped, such as removing or renaming a field. The Worker also has `MIN_API_LEVEL`, the oldest level it serves.

- **Header:** the client sends `X-Api-Level: <API_LEVEL>` on every request. `call` in `src/client/api.ts` adds it, GETs included.
- **Accepted values:** a plain positive decimal integer. An empty value, whitespace, a sign, a fraction, `0`, leading zeros or a number too large to be exact is 400 `bad_request`.
- **Missing header:** accepted. curl, uptime checks and clients built before the header existed send none, and refusing them would break them for no gain. A browser app always sends it.
- **Too low:** a level below `MIN_API_LEVEL` is 426 `client_outdated`, checked before every other guard (`requireApiLevel` in `src/worker/http.ts`). A level above the Worker's is accepted.
- **Exempt:** `/api/health`, so a monitor works whatever it sends.
- **Live sockets** carry no header, because a browser's WebSocket can't set one. The upgrade is checked like any other `/api/*` request, but a socket that is already open is not. What carries the check is the refetch the client makes on every open: it is an ordinary request with the header.
- **The client's reaction:** `call` turns a `client_outdated` answer into the failure `{type: "client_outdated"}` and sets the flag in `src/client/clientOutdated.ts`. The root layout then shows `UpdateRequired` (heading "Update to continue", one "Update now" button that calls `applyUpdate` from `useAppUpdate` in `src/client/appUpdate.ts`: it hands over to a waiting service worker and reloads, or, with none waiting, removes the service worker and the caches and reloads) in place of the routed page. Unmounting the page closes its live socket, so nothing keeps retrying.
- **Only add.** A change that keeps `API_LEVEL` may add an optional response field, a route or an error code, and nothing else. A client ignores a field it doesn't know. An error code it doesn't know becomes the failure `{type: "unknown_code", status, code}` with the generic message, and a live message of a shape it doesn't know still triggers a refetch.
- **Fixtures:** `src/shared/fixtures/level1/` holds a frozen sample of every message of level 1, and `src/shared/compat.test.ts` checks that the current schemas still parse them. The fixtures are append-only: never edit one to make a test pass.
- **Shipping a break:** raise `API_LEVEL`, add a `src/shared/fixtures/level2/` folder with the new messages (keep `level1/`, so the test still shows what changed), and set `MIN_API_LEVEL` to the new level only once old clients must be locked out. See "Raising `MIN_API_LEVEL`" in `deployment.md`.

## Suggestions

`POST /api/stories/:id/suggestions` returns three ways to continue the story. It reads the story and writes only its quota row: no story text, no turn change, no `turnVersion` bump, no live message. The request body is ignored (the `Content-Type` and Origin guards still apply).

- **Checks, in order:** story exists (404), caller is a participant (403 `not_participant`), caller holds the turn (403 `not_your_turn`), caller is under the limit (429 `ai_rate_limited`), provider answers (503 `ai_unavailable`).
- **Holder:** decided by `resolveTurn(state, now)`, as in `docs/turn-persistence.md`. A holder whose window has lapsed gets `not_your_turn`; the next holder is allowed. A waiting story has no holder, so everyone gets `not_your_turn`. A turn that lapses while the model is thinking doesn't matter: nothing is written, and the client's later contribution is checked by its own `turnVersion`.
- **Limit:** 3 requests per participant in any rolling hour (`SUGGESTION_LIMIT`, `SUGGESTION_WINDOW_MS`), counted across stories. A request made at `t` counts until `t + 1 h`, and is out of the count at exactly `t + 1 h`.
- **Counting is atomic.** `reserveSuggestion` (`src/worker/db/suggestionRepo.ts`) is one `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < limit`, so concurrent requests can't both see room for one more. The `suggestion_requests` row is written before the provider is called.
- **Which failures keep the slot** (`SuggestionFailure` in `src/worker/suggestions/provider.ts`). All three answer 503 `ai_unavailable`.
  - `model_error`: the call threw (outage, quota, network). The row is deleted again, because the participant got nothing. A concurrent request that arrives while the failed one still holds its slot can get 429 that it wouldn't have got a moment later.
  - `unusable_output`: the model answered, twice, with output that never parsed or was empty or duplicated. Both calls cost money, so the slot stays used.
  - `timed_out`: the call may still finish and be billed, so the slot stays used.
- **Parse failures** are retried once; a thrown error is not. A call over 25 s (`SUGGESTION_TIMEOUT_MS`, retry included) is given up on. The model call can't be cancelled (the AI binding takes no abort signal), so the provider is handed an `AbortSignal` that aborts at the deadline: a slow first attempt that comes back unusable after that never starts its retry.
- **Settling the slot can fail.** A provider that throws is treated as a `model_error`. If deleting the row fails, it is logged and the 503 still goes out; that participant loses one slot for an hour. The same happens if the Worker dies between reserving and settling.
- **Output:** each suggestion is trimmed and cut to the passage limit in graphemes (`truncatePassage`); empty or duplicate ones (ignoring case and Unicode form) make the output unusable. The story goes to the model as the last 6,000 characters inside `<story>` tags, with the instructions (including the passage limit, from `MAX_PASSAGE_LENGTH`) in the system message and a closing instruction after the story. Any `<story>` or `</story>` lookalike in the story text (any case, spaces inside) has its `<` written as `&lt;`.
- **Config:** `AI_PROVIDER` is `workers-ai` or `fake`; `AI_MODEL` is optional and defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, so any other value must support JSON-schema output. `parseAiConfig` (`src/worker/config.ts`) parses them once per `env` on the first suggestions request, not at startup (Workers have no startup hook with `env`). A bad value is a 500 `internal_error` with the reason in the log, before any quota is used. Local dev and tests use `fake`, and `pnpm dev` starts wrangler with remote bindings off unless the shell sets `AI_REMOTE=1` (the only way to try the real model locally, after `wrangler login`; not run here). Preview and production set `workers-ai`. `.dev.vars.example` lists both variables.
- **Known limitations:** old `suggestion_requests` rows are never deleted. The limit is per participant, so a person who mints new cookies and joins again gets fresh quota; set a Workers AI budget alert.
- **Untested against real Cloudflare:** the actual `env.AI.run` call. Tests stand in for it, so these are assumptions from Cloudflare's docs: the `{response}` output shape (object or JSON text, both handled), the `response_format: { type: "json_schema", … }` input, and the `JSON Mode couldn't be met` error text (treated as bad output and retried). Real model quality, latency against the 25 s timeout, quota error shapes and Workers AI billing are also unchecked. The workerd test doesn't call the route.

## Live updates

`GET /api/stories/:id/live` upgrades to a WebSocket held by that story's `StoryRoom` Durable Object. The room holds no story data: D1 stays the only store.

- **Checks, in order:** `Upgrade: websocket`, any case (else 426), same-origin `Origin` (403 `forbidden_origin`), ID shape and story (404 `not_found`), participant cookie (403 `not_participant`). Only then is the request forwarded to the room.
- **Message:** the room sends the JSON text `{"version": <turnVersion>}` (`liveMessageSchema` in `src/shared/api.ts`) to every socket of the story after each join, rejoin, leave, contribution and skip. The version is the turn version the write produced. Create sends nothing: nobody can be connected yet. A client refetches on any message that is JSON text, whatever its shape, so a message kind from a newer Worker still triggers a refetch. It ignores text that isn't JSON and binary frames, and does not need the version.
- **Notify:** routes call `notifyRoom` (`src/worker/live.ts`) after the D1 write succeeds. It hands the room's `notify` RPC call to `waitUntil` and returns at once, so a slow or hung room can't delay a committed write. A failure is logged and swallowed, never turned into an error response: clients catch up on their next refetch or reconnect. Browsers can't call `notify`; they only reach the room's `fetch` (the upgrade) through the guarded route.
- **Client:** the live logic in `src/client/live.ts` says when to refetch: on every open, every JSON message and a second after `turn.endsAt` (a turn that times out sends no message). `useStoryLive` mounts it on the story page. The socket sends no `X-Api-Level`; the refetch on open does (see "Versioning").
  - The `endsAt` timer re-arms every 5 seconds until `endsAt` changes, because a client clock ahead of the server's would otherwise fire early and never try again.
  - Reconnects back off from 0.5 s to 30 s. The backoff restarts only after a socket stays open 10 s or delivers a live message, so a server that accepts and drops the socket is retried ever more slowly.
  - A `ping` every 25 s; no `pong` within 10 s marks the socket dead and reconnects.
  - The client opens a socket only on a joined participant's story page (a non-participant's upgrade is a 403).
- **Hibernation:** the room uses the hibernation API. `ping` is answered by the runtime with `pong` without waking the object.
- **A cookie is read at the upgrade only.** An open socket is not rechecked. A writer who leaves keeps their sockets, so they go on receiving version numbers (nothing else is sent) until the socket closes; a refetch then answers 403 `left_story`. Closing them would need the room to tag sockets by participant, which it does not do.

## Cookie

`__Host-andthen_bt` (HttpOnly, Secure, SameSite=Lax, Path=/, 1 year) everywhere except `http://localhost`, where it is `andthen_bt` without `Secure`. The value is 32 random bytes in hex; only its SHA-256 hash is stored in `participants.browser_token_hash`. `readBrowserToken` returns `""` for no cookie, which matches no participant.

## Writes and races

Each write is one `db.batch()`. Every statement is guarded by `turn_version = <loaded version>`, so a write that lost a race changes nothing and the route answers 409 `stale_turn`. A join or contribution inserts its row _before_ the story update, so both test the same unchanged snapshot. Unique constraints (`display_name_key`, `browser_token_hash`) are a backstop only: routes check names and tokens against the loaded participants first, and any change to those rows bumps the version.

Story creation retries with a new ID when the ID is taken (up to `STORY_ID_ATTEMPTS`). A failed create batch leaves nothing behind (it is atomic), so `createStory` asks `SELECT 1 FROM stories WHERE id = ?` to tell a collision from any other error. It does not read the constraint error text, whose wording differs between Miniflare and real D1 and is untested against real D1.

## Testing

- `createApp({ now, newStoryId, suggestionProvider, minApiLevel })` in `src/worker/app.ts` takes the clock, the ID source, a function from `env` to a `SuggestionProvider` and, optionally, the minimum API level (`MIN_API_LEVEL` by default), which a test raises to get `client_outdated`. `app` is the real-clock default; `index.ts` re-exports it.
- `test/support/browser.ts`: `createTestApp(clock, newStoryId?, suggestionProvider = fakeProvider)` and `createBrowser(app, env)`, a browser with its own cookie jar that sends a same-origin `Origin`, `Content-Type: application/json` and the current `X-Api-Level` by default. Its request options take `apiLevel`: a string to send instead, or `null` to send no header. Build a `Browser` with an `https://app.andthen.page` origin to get the `__Host-` cookie.
- `test/live.test.ts`: the live guard and `notifyRoom` calls in Node, with a stand-in `STORY_ROOM` passed as `env` (Node can't build a 101 response, so its `fetch` answers 200). A browser's `backgroundWork` holds what the app gave `waitUntil`.
- `test/storyRoom.workerd.test.ts`: the real Worker and `StoryRoom` in workerd through wrangler's `createTestHarness`, with real WebSockets. It reads `wrangler.jsonc` and drops `assets` (which needs a built `dist/`). `index.ts` and `storyRoom.ts` aren't mutated by Stryker, so this is their only coverage.
- `test/support/gatedDb.ts`: `gateLoads(db, n)` holds `n` concurrent requests at their story load until all have loaded, so they race on one stored version. Pass it as `{ env: { DB: gateLoads(...) } }` in the request options.
- A route that touches no D1 can be tested with a stand-in `DB`: repo functions take `Db`, a `Pick<D1Database, "prepare" | "batch">`.
