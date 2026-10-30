# Story API

Routes live in `src/worker/routes/stories.ts`, SQL in `src/worker/db/storyRepo.ts`. Request and response shapes are in `src/shared/api.ts`. `docs/turn-persistence.md` says how turn state is saved.

## Routes

| Route                                 | Success               | Notes                                                                                       |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `POST /api/stories`                   | 201 `{storyId}`       | Sets the cookie if the browser has none. A browser may start many stories under one cookie. |
| `GET /api/stories/:id`                | 200 `StoryView`       | 404 unknown ID, then 403 `not_participant`. Turn comes from `resolveTurn(state, now)`.      |
| `POST /api/stories/:id/participants`  | 201 `{participantId}` | Sets the cookie if the browser has none.                                                    |
| `POST /api/stories/:id/contributions` | 204                   | Body `{text, turnVersion}`.                                                                 |
| `POST /api/stories/:id/skip`          | 204                   | Body `{turnVersion}`.                                                                       |
| `GET /api/stories/:id/live`           | 101 (WebSocket)       | Participants only. See "Live updates".                                                      |

Mutating routes send no body back. Clients refetch `GET /api/stories/:id`; the live socket tells them when.

## Error statuses

One status per code, in `ERROR_STATUS` in `src/worker/http.ts` (a `Record<ErrorCode, …>`, so a new code can't be forgotten).

- **400:** `bad_request`, `invalid_passage`, `invalid_display_name`.
- **403:** `forbidden_origin`, `not_participant`, `not_your_turn`, `cannot_skip_self`.
- **404:** `not_found`. An ID that can't be a story ID is also 404, with no database call. An unknown `/api/*` path is a JSON 404 too.
- **409:** `stale_turn`, `name_taken`, `already_joined`, `no_one_to_skip_to`.
- **429 / 503:** `ai_rate_limited` / `ai_unavailable`, for Phase 5.
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

## Live updates

`GET /api/stories/:id/live` upgrades to a WebSocket held by that story's `StoryRoom` Durable Object. The room holds no story data: D1 stays the only store.

- **Checks, in order:** `Upgrade: websocket` (else 426), same-origin `Origin` (403 `forbidden_origin`), ID shape and story (404 `not_found`), participant cookie (403 `not_participant`). Only then is the request forwarded to the room.
- **Message:** the room sends the JSON text `{"version": <turnVersion>}` (`liveMessageSchema` in `src/shared/api.ts`) to every socket of the story after each join, contribution and skip. The version is the turn version the write produced. Create sends nothing: nobody can be connected yet. A client refetches on any valid message and does not need the version.
- **Notify:** routes call `notifyRoom` (`src/worker/live.ts`) after the D1 write succeeds, which calls the room's `notify` RPC method. A failure is logged and swallowed, never turned into an error response: the write is already saved, and clients catch up on their next refetch or reconnect. Browsers can't call `notify`; they only reach the room's `fetch` (the upgrade) through the guarded route.
- **Client:** `useStoryLive` (`src/client/useStoryLive.ts`) reconnects with backoff and refetches on every open, every valid message and a second after `turn.endsAt` (a turn that times out sends no message). Its logic is in `src/client/live.ts`.
- **Hibernation:** the room uses the hibernation API. `ping` is answered by the runtime with `pong` without waking the object.
- **A cookie is read at the upgrade only.** An open socket is not rechecked, which is fine while nobody can leave a story.

## Cookie

`__Host-andthen_bt` (HttpOnly, Secure, SameSite=Lax, Path=/, 1 year) everywhere except `http://localhost`, where it is `andthen_bt` without `Secure`. The value is 32 random bytes in hex; only its SHA-256 hash is stored in `participants.browser_token_hash`. `readBrowserToken` returns `""` for no cookie, which matches no participant.

## Writes and races

Each write is one `db.batch()`. Every statement is guarded by `turn_version = <loaded version>`, so a write that lost a race changes nothing and the route answers 409 `stale_turn`. A join or contribution inserts its row _before_ the story update, so both test the same unchanged snapshot. Unique constraints (`display_name_key`, `browser_token_hash`) are a backstop only: routes check names and tokens against the loaded participants first, and any change to those rows bumps the version.

Story creation retries with a new ID when the ID is taken (up to `STORY_ID_ATTEMPTS`). A failed create batch leaves nothing behind (it is atomic), so `createStory` asks `SELECT 1 FROM stories WHERE id = ?` to tell a collision from any other error. It does not read the constraint error text, whose wording differs between Miniflare and real D1 and is untested against real D1.

## Testing

- `createApp({ now, newStoryId })` in `src/worker/app.ts` takes the clock and the ID source. `app` is the real-clock default; `index.ts` re-exports it.
- `test/support/browser.ts`: `createTestApp(clock)` and `createBrowser(app, env)`, a browser with its own cookie jar that sends a same-origin `Origin` and `Content-Type: application/json` by default. Build a `Browser` with an `https://app.andthen.page` origin to get the `__Host-` cookie.
- `test/live.test.ts`: the live guard and `notifyRoom` calls in Node, with a stand-in `STORY_ROOM` passed as `env` (Node can't build a 101 response, so its `fetch` answers 200).
- `test/storyRoom.workerd.test.ts`: the real Worker and `StoryRoom` in workerd through wrangler's `createTestHarness`, with real WebSockets. It uses an inline copy of `wrangler.jsonc` without `assets` (which needs a built `dist/`); keep the bindings in step. `index.ts` and `storyRoom.ts` aren't mutated by Stryker, so this is their only coverage.
- `test/support/gatedDb.ts`: `gateLoads(db, n)` holds `n` concurrent requests at their story load until all have loaded, so they race on one stored version. Pass it as `{ env: { DB: gateLoads(...) } }` in the request options.
- A route that touches no D1 can be tested with a stand-in `DB`: repo functions take `Db`, a `Pick<D1Database, "prepare" | "batch">`.

## Left for later phases

- **Phase 5:** `suggestions` route and `config.ts` env parsing (`AI_PROVIDER`, `AI_MODEL`); `config.ts` holds only constants for now.
- **Phase 6:** the client must keep composer text on 409 `stale_turn`.
