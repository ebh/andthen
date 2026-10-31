# Story API

Routes live in `src/worker/routes/stories.ts`, SQL in `src/worker/db/storyRepo.ts`. Request and response shapes are in `src/shared/api.ts`. `docs/turn-persistence.md` says how turn state is saved.

## Routes

| Route                                 | Success                        | Notes                                                                                       |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `POST /api/stories`                   | 201 `{storyId}`                | Sets the cookie if the browser has none. A browser may start many stories under one cookie. |
| `GET /api/stories/:id`                | 200 `StoryView`                | 404 unknown ID, then 403 `not_participant`. Turn comes from `resolveTurn(state, now)`.      |
| `POST /api/stories/:id/participants`  | 201 `{participantId}`          | Sets the cookie if the browser has none.                                                    |
| `POST /api/stories/:id/contributions` | 204                            | Body `{text, turnVersion}`.                                                                 |
| `POST /api/stories/:id/skip`          | 204                            | Body `{turnVersion}`.                                                                       |
| `POST /api/stories/:id/suggestions`   | 200 `{suggestions: [s, s, s]}` | Turn holder only. No body needed. See "Suggestions".                                        |
| `GET /api/stories/:id/live`           | 101 (WebSocket)                | Participants only. See "Live updates".                                                      |

Mutating routes send no body back, except suggestions, which is a read. Clients refetch `GET /api/stories/:id`; the live socket tells them when.

## Error statuses

One status per code, in `ERROR_STATUS` in `src/worker/http.ts` (a `Record<ErrorCode, …>`, so a new code can't be forgotten).

- **400:** `bad_request`, `invalid_passage`, `invalid_display_name`.
- **403:** `forbidden_origin`, `not_participant`, `not_your_turn`, `cannot_skip_self`.
- **404:** `not_found`. An ID that can't be a story ID is also 404, with no database call. An unknown `/api/*` path is a JSON 404 too.
- **409:** `stale_turn`, `name_taken`, `already_joined`, `no_one_to_skip_to`.
- **429:** `ai_rate_limited`. **503:** `ai_unavailable`. Both come from the suggestions route.
- **413:** `payload_too_large`, a body over `MAX_BODY_BYTES` (8 KB), refused before it is parsed.
- **500:** `internal_error`, anything unexpected, logged with `console.error`.

Every error body is JSON `{error: <code>}`, so a client can parse it with `errorBodySchema`. Every `/api/*` response carries `Cache-Control: no-store` (except a WebSocket upgrade).

Order of checks on a mutating route: Origin (403), Content-Type (400), body size (413), ID shape (404), JSON and shape (400), story exists (404), caller is a participant (403), content validation (400), turn rules (403/409), guarded write (409).

## Things a client or reviewer might not expect

- **Story existence leaks.** An unknown ID is 404 and a known story you aren't in is 403, so anyone can probe whether a story exists. This is the accepted ID risk from the plan.
- **Taken names leak.** A join to a story you aren't in answers `name_taken` for a name in use, so a link holder can learn the participants' names (a name can't be checked without joining).
- **Body parsing comes before the story lookup.** A malformed body is 400 even for a story that doesn't exist or that you aren't in.
- **A rejected join still sets the cookie.** A browser with no cookie gets one before the join is checked, and keeps it after a `name_taken` or `stale_turn`. It is harmless: the token belongs to no participant until a join succeeds, and a retry with another name reuses it.
- **A waiting story answers contribute and skip differently.** A contribution is 403 `not_your_turn` (nobody holds the turn); a skip is 409 `stale_turn` (the page showed a turn that is gone).
- **Plain cookie only on `http://localhost`.** `127.0.0.1` and LAN hosts get the `__Host-` Secure cookie, which browsers drop over plain HTTP, so dev must use `localhost`.

## Guards on every mutating request

- `Origin` must equal the request's own origin; a missing `Origin` fails. `GET`, `HEAD` and `OPTIONS` are exempt. The live upgrade is a `GET` but runs the same check (`requireSameOrigin`).
- `Content-Type` must be `application/json`, parameters allowed.

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
- **Config:** `AI_PROVIDER` is `workers-ai` or `fake`; `AI_MODEL` is optional and defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, so any other value must support JSON-schema output. `parseAiConfig` (`src/worker/config.ts`) parses them once per `env` on the first suggestions request, not at startup (Workers have no startup hook with `env`). A bad value is a 500 `internal_error` with the reason in the log, before any quota is used. Local dev and tests use `fake`, and `vite.config.ts` turns remote bindings off unless the shell sets `AI_REMOTE=1` (the only way to try the real model locally, after `wrangler login`; not run here). Preview and production set `workers-ai`. `.dev.vars.example` lists both variables.
- **Known limitations:** old `suggestion_requests` rows are never deleted. The limit is per participant, so a person who mints new cookies and joins again gets fresh quota; set a Workers AI budget alert.
- **Untested against real Cloudflare:** the actual `env.AI.run` call. Tests stand in for it, so these are assumptions from Cloudflare's docs: the `{response}` output shape (object or JSON text, both handled), the `response_format: { type: "json_schema", … }` input, and the `JSON Mode couldn't be met` error text (treated as bad output and retried). Real model quality, latency against the 25 s timeout, quota error shapes and Workers AI billing are also unchecked. The workerd test doesn't call the route.

## Live updates

`GET /api/stories/:id/live` upgrades to a WebSocket held by that story's `StoryRoom` Durable Object. The room holds no story data: D1 stays the only store.

- **Checks, in order:** `Upgrade: websocket`, any case (else 426), same-origin `Origin` (403 `forbidden_origin`), ID shape and story (404 `not_found`), participant cookie (403 `not_participant`). Only then is the request forwarded to the room.
- **Message:** the room sends the JSON text `{"version": <turnVersion>}` (`liveMessageSchema` in `src/shared/api.ts`) to every socket of the story after each join, contribution and skip. The version is the turn version the write produced. Create sends nothing: nobody can be connected yet. A client refetches on any valid message and does not need the version.
- **Notify:** routes call `notifyRoom` (`src/worker/live.ts`) after the D1 write succeeds. It hands the room's `notify` RPC call to `waitUntil` and returns at once, so a slow or hung room can't delay a committed write. A failure is logged and swallowed, never turned into an error response: clients catch up on their next refetch or reconnect. Browsers can't call `notify`; they only reach the room's `fetch` (the upgrade) through the guarded route.
- **Client:** `useStoryLive` (`src/client/useStoryLive.ts`) refetches on every open, every valid message and a second after `turn.endsAt` (a turn that times out sends no message). Its logic is in `src/client/live.ts`.
  - The `endsAt` timer re-arms every 5 seconds until `endsAt` changes, because a client clock ahead of the server's would otherwise fire early and never try again.
  - Reconnects back off from 0.5 s to 30 s. The backoff restarts only after a socket stays open 10 s or delivers a live message, so a server that accepts and drops the socket is retried ever more slowly.
  - A `ping` every 25 s; no `pong` within 10 s marks the socket dead and reconnects.
  - `StoryBoard` (`src/client/components/StoryBoard.tsx`) mounts the hook, so only joined participants open a socket (a non-participant's upgrade is a 403).
- **Hibernation:** the room uses the hibernation API. `ping` is answered by the runtime with `pong` without waking the object.
- **A cookie is read at the upgrade only.** An open socket is not rechecked, which is fine while nobody can leave a story.

## Cookie

`__Host-andthen_bt` (HttpOnly, Secure, SameSite=Lax, Path=/, 1 year) everywhere except `http://localhost`, where it is `andthen_bt` without `Secure`. The value is 32 random bytes in hex; only its SHA-256 hash is stored in `participants.browser_token_hash`. `readBrowserToken` returns `""` for no cookie, which matches no participant.

## Writes and races

Each write is one `db.batch()`. Every statement is guarded by `turn_version = <loaded version>`, so a write that lost a race changes nothing and the route answers 409 `stale_turn`. A join or contribution inserts its row _before_ the story update, so both test the same unchanged snapshot. Unique constraints (`display_name_key`, `browser_token_hash`) are a backstop only: routes check names and tokens against the loaded participants first, and any change to those rows bumps the version.

Story creation retries with a new ID when the ID is taken (up to `STORY_ID_ATTEMPTS`). A failed create batch leaves nothing behind (it is atomic), so `createStory` asks `SELECT 1 FROM stories WHERE id = ?` to tell a collision from any other error. It does not read the constraint error text, whose wording differs between Miniflare and real D1 and is untested against real D1.

## Testing

- `createApp({ now, newStoryId, suggestionProvider })` in `src/worker/app.ts` takes the clock, the ID source and a function from `env` to a `SuggestionProvider`. `app` is the real-clock default; `index.ts` re-exports it.
- `test/support/browser.ts`: `createTestApp(clock, newStoryId?, suggestionProvider = fakeProvider)` and `createBrowser(app, env)`, a browser with its own cookie jar that sends a same-origin `Origin` and `Content-Type: application/json` by default. Build a `Browser` with an `https://app.andthen.page` origin to get the `__Host-` cookie.
- `test/live.test.ts`: the live guard and `notifyRoom` calls in Node, with a stand-in `STORY_ROOM` passed as `env` (Node can't build a 101 response, so its `fetch` answers 200). A browser's `backgroundWork` holds what the app gave `waitUntil`.
- `test/storyRoom.workerd.test.ts`: the real Worker and `StoryRoom` in workerd through wrangler's `createTestHarness`, with real WebSockets. It reads `wrangler.jsonc` and drops `assets` (which needs a built `dist/`). `index.ts` and `storyRoom.ts` aren't mutated by Stryker, so this is their only coverage.
- `test/support/gatedDb.ts`: `gateLoads(db, n)` holds `n` concurrent requests at their story load until all have loaded, so they race on one stored version. Pass it as `{ env: { DB: gateLoads(...) } }` in the request options.
- A route that touches no D1 can be tested with a stand-in `DB`: repo functions take `Db`, a `Pick<D1Database, "prepare" | "batch">`.
