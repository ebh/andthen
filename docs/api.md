# Story API

Routes live in `src/worker/routes/stories.ts`, `src/worker/routes/pushSubscriptions.ts` and `src/worker/routes/users.ts`, SQL in `src/worker/db/storyRepo.ts`, `src/worker/db/pushRepo.ts` and `src/worker/db/userRepo.ts`. Request and response shapes are in `src/shared/api.ts`. `docs/turn-persistence.md` says how turn state is saved. `.claude/rules/api.md` has the rules for adding a route, and `docs/domain.md` the words its path uses.

## Routes

| Route                                                | Success                            | Notes                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/stories`                                   | 200 `{stories: [...], nextCursor}` | One page of the stories this user is in and has not left. Query `limit`, `cursor`. See "Your stories".                      |
| `POST /api/stories`                                  | 201 `{storyId}`                    | `Location` is the story. Creates the user if there is none. An anonymous browser gets the cookie. See "Identity".           |
| `GET /api/stories/:storyId`                          | 200 `StoryView`                    | 404 unknown ID, then 403 `not_participant` or `left_story`. Turn from `resolveTurn`.                                        |
| `POST /api/stories/:storyId/participants`            | 201 `{participantId}`              | `Location` is the participant. Creates the user if there is none. An anonymous browser gets the cookie.                     |
| `POST /api/stories/:storyId/contributions`           | 201 `{contributionId}`             | `Location` is the contribution. Body `{text, turnVersion, startsParagraph}`. The opening passage always starts a paragraph. |
| `POST /api/stories/:storyId/skip`                    | 204                                | Body `{turnVersion}`.                                                                                                       |
| `POST /api/stories/:storyId/leave`                   | 204                                | Body `{}`. See "Leaving and rejoining".                                                                                     |
| `POST /api/stories/:storyId/rejoin`                  | 204                                | Body `{}`. Only for a user who left. See "Leaving and rejoining".                                                           |
| `POST /api/stories/:storyId/suggestions`             | 200 `{suggestions: [s, s, s]}`     | Turn holder only. No body needed. See "Suggestions".                                                                        |
| `GET /api/stories/:storyId/live`                     | 101 (WebSocket)                    | Participants only. See "Live updates".                                                                                      |
| `PUT /api/push-subscriptions/:pushSubscriptionId`    | 204                                | Body is a `PushSubscription.toJSON()`; the ID is the hash of its endpoint. See "Web Push".                                  |
| `PUT /api/users/me/account`                          | 204                                | Body `{}`. Needs a session token. Attaches the account to this device or merges. See "Accounts".                            |
| `DELETE /api/push-subscriptions/:pushSubscriptionId` | 204                                | No body. See "Web Push".                                                                                                    |
| `GET /api/push-key`                                  | 200 `{publicKey}`                  | The VAPID public key. See "Web Push".                                                                                       |

Every route resolves who is asking as described under "Identity". Routes that create a story, participant or contribution answer 201 with the new ID. The other mutating routes send no body back, except suggestions, which is a read. The `Location` of a participant or a contribution names a path with no `GET` route yet. Clients refetch `GET /api/stories/:storyId`; the live socket tells them when.

## Error statuses

One status per code, in `ERROR_STATUS` in `src/worker/http.ts` (a `Record<ErrorCode, …>`, so a new code can't be forgotten).

- **400:** `bad_request`, `invalid_passage`, `invalid_display_name`.
- **401:** `invalid_session_token`: a session token that is missing where one is required, malformed or rejected. It carries a `WWW-Authenticate` header. See "Identity".
- **403:** `forbidden_origin`, `not_participant`, `left_story`, `not_your_turn`, `cannot_skip_self`.
- **404:** `not_found`. An ID that can't be a story ID is also 404, with no database call. An unknown `/api/*` path is a JSON 404 too.
- **409:** `stale_turn`, `name_taken`, `already_joined`, `story_full`, `no_one_to_skip_to`.
- **429:** `ai_rate_limited`. **503:** `ai_unavailable`. Both come from the suggestions route.
- **413:** `payload_too_large`, a body over `MAX_BODY_BYTES` (8 KB), refused before it is parsed.
- **500:** `internal_error`, anything unexpected, logged with `console.error`.

Every error body is JSON `{error: <code>}`, so a client can parse it with `errorBodySchema`. The one exception is `left_story`, whose body also carries `displayName` and `opening` (see "Leaving and rejoining"). Every `/api/*` response carries `Cache-Control: no-store` (except a WebSocket upgrade).

- **426:** `client_outdated`, an `X-Api-Level` below the Worker's minimum. See "Versioning". A live upgrade without `Upgrade: websocket` is also 426, with a different body.

Order of checks on a mutating route: API level (400 malformed, 426 too low), Origin or credential header (403), Content-Type, or no body on a `DELETE` (400), body size (413), ID shape (404), JSON and shape (400), story exists (404), caller is a participant (403; 403 `left_story` for one who left), content validation (400), turn rules (403/409), guarded write (409). A session token is checked when a route first needs to know the user: with the participant check on a story route, and before the body on `PUT /api/users/me/account`. A bad token is 401 whatever follows.

## Things a client or reviewer might not expect

- **Story existence leaks.** An unknown ID is 404 and a known story you aren't in is 403, so anyone can probe whether a story exists. This is an accepted risk of short story IDs; see "Accepted risks" in `deployment.md`.
- **Taken names leak.** A join to a story you aren't in answers `name_taken` for a name in use, so a link holder can learn the participants' names (a name can't be checked without joining).
- **Body parsing comes before the story lookup.** A malformed body is 400 even for a story that doesn't exist or that you aren't in.
- **A rejected join still creates the user.** An anonymous browser with no cookie gets one, and a user row, before the join is checked, and keeps both after a `name_taken` or `stale_turn`. It is harmless: the user is in no story until a join succeeds, and a retry with another name reuses it.
- **A waiting story answers contribute and skip differently.** A contribution is 403 `not_your_turn` (nobody holds the turn); a skip is 409 `stale_turn` (the page showed a turn that is gone).
- **A cookie is ignored when the header is present.** A client that sends `X-Device-Token` is identified by it alone, even if it also sends a cookie that names another user.
- **A store app's device token is made by the client.** The Worker issues nothing for it, so the first request already carries it, and a `GET` before the first write works.
- **Plain cookie only on `http://localhost`.** `127.0.0.1` and LAN hosts get the `__Host-` Secure cookie, which browsers drop over plain HTTP, so dev must use `localhost`.

## Your stories

`GET /api/stories` lists the stories whose participant rows belong to the requesting user and have no `left_at`, using the `participants_by_user` index. It only reads: no cookie or user is created, and a request that names no user gets `{stories: [], nextCursor: null}`. A signed-in user gets the same list on every device.

- **Entry:** `id`, `opening` (the first passage in full), `holderName` (null while the story waits), `isMyTurn`, `endsAt` (null while it waits) and `writerCount` (writers still in the story).
- **Turn:** `resolveTurn(state, now)`, as in the story view, so an expired turn shows its new holder. Nothing is written.
- **Order:** stories where the caller holds the turn first, then the newest passage first, then ID, so the order is stable between requests.
- **One snapshot:** the story rows, their writers and their first passages come from one `db.batch()`.
- **Paging:** the query takes `limit` (a whole number from 1 to `MY_STORIES_MAX_LIMIT`, 50; `MY_STORIES_DEFAULT_LIMIT`, 20, when absent) and `cursor`. A page is the next `limit` stories after the cursor, and `nextCursor` is the cursor for the page after it, or null on the last page. A `limit` that is not a plain positive whole number up to the maximum, an empty `cursor` and a `cursor` this API did not make are 400 `bad_request` (`myStoriesQuerySchema`).
- **The cursor** is the sort key of the page's last story (caller's turn, newest passage time, ID), encoded as base64url (`src/worker/storyCursor.ts`). Clients treat it as opaque. The next page is every story that sorts after that key, so it stays right when the story at the key has left the list.
- **Not bounded in the query:** the Worker still reads every story of the user and cuts the page afterwards, because the order depends on the clock (whose turn it is after `resolveTurn`). A response is bounded; the work is not. A story can be skipped or shown twice when a turn changes or a passage is written between two page loads. See "Accepted risks" in `deployment.md`.

## Leaving and rejoining

Leaving is soft. `POST /api/stories/:storyId/leave` sets `participants.left_at` and keeps the row, because passages join to their author and a name stays reserved in its story.

- **Turn:** `onLeave` takes the position out of the turn order and bumps the version. If the leaver held the turn it passes to the next eligible writer with a fresh window. If nobody else is eligible (the leaver was alone, or the one writer left wrote last) the story waits. A story with no writers left stays open: anyone with the link can join and take the turn.
- **After leaving:** every route that needs a participant answers 403 `left_story` with `{error, displayName, opening}`: the name the writer had there and the story's opening, so the page can offer "Rejoin as <name>". A second leave is the same. The join route still answers `already_joined`, because the old name and user stay on the row, so a leaver gets back only through rejoin.
- **Names:** a leaver's name stays taken in that story, so a new joiner can't reuse it.
- **Rejoin:** `POST /api/stories/:storyId/rejoin` clears `left_at` and gives the row the position at the end of the turn order (`LoadedStory.nextPosition`, one past the highest position ever held, a leaver's included, so it never collides with the unique `(story_id, position)`). `onRejoin` keeps a writer who wrote last as the last contributor under their new position, so coming back never earns two turns in a row, and a waiting story stays waiting for them. 403 `not_participant` for a user who was never in the story, 409 `already_joined` for one who is in it, 409 `story_full` when the story filled while they were away.
- **Races:** both routes are guarded by the loaded `turn_version` like every write, so one that loses a race answers 409 `stale_turn`.
- **Body:** `{}` and nothing else; a body with anything in it is 400 `bad_request` (`emptyRequestSchema`).

## Participant cap

A story holds at most `MAX_PARTICIPANTS` (50, creator included), because anyone with the link can join and each joiner can hold the turn for 24 hours. Only writers who are still in the story count: one who left frees their place. A join to a full story is 409 `story_full`, and so is a rejoin. Creating a story and reading it are not affected.

- **Which error wins:** `already_joined`, then `name_taken`, then `story_full`. A duplicate name or a repeat join on a full story keeps its own code. Only a join that would otherwise succeed gets `story_full`.
- **The version guard already serialises joins.** Every join bumps `turn_version`, so of two joins racing at 49 only one passes the `turn_version` guard (see "Writes and races").
- **The count guard is a second defence in the write.** The join `INSERT` and the rejoin `UPDATE` also need `(SELECT COUNT(*) FROM participants WHERE story_id = ? AND left_at IS NULL) < MAX_PARTICIPANTS`, so a call with a current version still can't add a 51st. The turn `UPDATE` needs the participant to be in the story (the row exists and `left_at` is null), so a refused insert or rejoin never moves the turn.
- **A refused write is explained by a re-read.** When `addParticipant` or `rejoinStory` returns false, the route reloads the story: 50 participants is `story_full`, anything else is `stale_turn`. Two joins racing at 49 therefore end as one 201 and one `story_full`.
- A refused join writes nothing, bumps no `turnVersion` and sends no live message.

## Identity

Every route that needs to know who is asking resolves a user (`resolveMe` and `requireOrCreateMe` in `src/worker/me.ts`). Accounts are optional, so there are three ways to be identified, and a request uses exactly one, in this order.

- **Session token.** A signed-in client sends the session token as `Authorization: Bearer <token>` on every call. The Worker checks it and the user is the one who holds that account. A request with a session token never looks at the device token.
- **Device token in a header.** A store app has no cookie jar to rely on, so it sends `X-Device-Token: <token>` (`DEVICE_TOKEN_HEADER` in `src/shared/deviceToken.ts`). The token is 64 lowercase hex characters (`deviceTokenSchema`), which the phone makes itself from 32 random bytes on first launch and keeps in secure storage. Only its SHA-256 hash is stored, as for the cookie. A request with the header never looks at the cookie, because a native HTTP client may keep a cookie store of its own, and is never given a `Set-Cookie`. An empty or malformed header is 400 `bad_request`; it never counts as "no token".
- **Device token in a cookie.** With neither of the above, the cookie decides (see "Cookie"). A browser with no cookie, or a cookie that names no user, has no user yet.
- **Where a user is made.** `GET` routes and `DELETE` never create a user. `POST /api/stories` and the join route do: an account user for a session token, otherwise an anonymous user. A browser with no cookie is given one; a request with the header is not.
- **The live socket** carries the token in its subprotocols instead (see "Live updates").

The token check lives in `src/worker/sessionToken.ts`. It verifies the signature against the instance's public key (`CLERK_JWT_KEY`, a Worker var), so it makes no network call.

- **The origin is checked.** The token's `azp` claim must equal the request's origin. A token without an `azp` claim is rejected, because without the claim the library skips the origin check.
- **A rejected token is a 401.** An expired token, a bad signature, a wrong origin, a missing `azp` and an `Authorization` header that is not `Bearer <token>` all answer 401 `invalid_session_token`. The reason goes to the Worker log and never to the client.
- **No fallback to the cookie.** A rejected token never turns the request into an anonymous one, so a signed-in request cannot quietly act as another user.
- **`WWW-Authenticate` says why** (RFC 6750). A request that sent no credentials where a session is required gets `WWW-Authenticate: Bearer` (`NO_TOKEN_CHALLENGE`). A request that sent a token that was rejected gets `WWW-Authenticate: Bearer error="invalid_token"`. `ApiError` carries the value as `challenge` (`src/worker/http.ts`).

## Accounts

`PUT /api/users/me/account` (`src/worker/routes/users.ts`) ties the requesting device to the signed-in account. Body `{}` (else 400 `bad_request`), answer 204. It needs a session token, checked before the body: no token is 401 `invalid_session_token` with `WWW-Authenticate: Bearer`.

The device user is the user the cookie names. With no cookie, or a cookie that names no user, there is nothing to do and the route answers 204.

- **No account user yet:** the account is attached to the device user (`attachAccount` in `src/worker/db/userRepo.ts`). The user keeps its participants and push subscriptions, gains the Clerk user ID and loses its browser token hash.
- **The account already has a user:** the device user is merged into it, in two steps.
  - **First,** for each story where both users are writers who have not left, the device user's participant leaves, as a leave does (`leaveAsParticipant` in `src/worker/leave.ts`: the turn passes on and the room and the new holder are told). A leave that loses a race with another write on the story is retried with a fresh load, up to `MERGE_LEAVE_ATTEMPTS` (3) times, then the route answers 409 `stale_turn`.
  - **Then** one `db.batch()` points the device user's participants and push subscriptions at the account user and deletes the device user (`mergeUserInto`).
- **Safe to repeat.** After a success the cookie names no user, so a second call finds none and answers 204. A call cut short by a failure or a 409 finishes on the next one.
- **Same story, two writers.** The device user's participant has left and keeps its row, now tied to the account user. Joining the two participants into one is not built (issue #48).

### How the app uses it

- **Sending the token.** `call` in `src/client/api.ts` adds `Authorization: Bearer <token>` when the client is signed in. The token comes from `getSessionToken` (`src/client/sessionToken.ts`), which asks Clerk each time and never caches one.
- **Waiting for Clerk.** Before the first request the client waits up to `SIGN_IN_STATE_WAIT_MS` (3 s) for Clerk to load, so a signed-in device does not go out as anonymous. When the wait runs out the request goes out anonymously, and later requests don't wait again (they use Clerk if it has loaded by then), so a blocked Clerk delays the first request once. Anonymous use never depends on Clerk.
- **A rejected token.** On 401 `invalid_session_token` the client fetches a fresh token and retries once. If that fails too, the failure is shown as for any other.
- **Adding the device.** `addDeviceUserToAccount` (`src/client/account.ts`) calls the account route after sign-in and on every app load while signed in (`AddDeviceUserOnLoad` mounts it), so a merge that was cut short finishes. Overlapping calls share one request, and a 409 `stale_turn` is retried once after a second. When it works, `onDeviceUserAdded` listeners run and the list of stories refetches. Any other failure is silent until the next call.
- **Signing out.** `SignInStatus` switches the device's turn notifications off first, while the session can still authorise the delete, then signs out.

## Guards

- **API level, on every `/api/*` request:** see "Versioning". It runs first, so a stale client gets `client_outdated` whatever else is wrong with its request.
- **On a mutating request:** `isTrustedOrigin` in `src/worker/http.ts` decides, and a refusal is 403 `forbidden_origin`. `GET`, `HEAD` and `OPTIONS` are exempt. The live upgrade is a `GET` but runs the same check (`requireTrustedOrigin`).
  - **An `Origin` that is present must be the request's own,** whatever else the request carries. The string `null` is a value, so it fails. A device token or session token never excuses a wrong `Origin`.
  - **A missing `Origin` passes only with a credential header:** `X-Device-Token`, `Authorization`, or on an upgrade a session token among the offered subprotocols. A cookie does not count. The check is for presence only; whether the value is good is decided where the user is resolved (400 or 401).
  - **Why that is safe against cross-site request forgery:** a page on another site can send a request to this Worker with the browser's cookie, but it can't add `X-Device-Token` or `Authorization` without a CORS preflight, and the Worker answers none. Such a request therefore arrives with an `Origin` that isn't ours, or with no credential header, and is refused.
  - **There is no CORS handling,** for the same reason: native clients don't use CORS, and the web app is same-origin.
- **On a mutating request:** `Content-Type` must be `application/json`, parameters allowed. A `DELETE` is the exception: its path names everything it removes, so it must send no body, and a body is 400 `bad_request`.
- **Session token, where a route needs the user:** a token that is present must verify, or the answer is 401 `invalid_session_token`. See "Identity".

## Versioning

The API level is a whole number, `API_LEVEL` in `src/shared/apiLevel.ts`. It is bumped by hand, and only for a change that breaks a client that already shipped, such as removing or renaming a field. The Worker also has `MIN_API_LEVEL`, the oldest level it serves.

- **Header:** the client sends `X-Api-Level: <API_LEVEL>` on every request. `call` in `src/client/api.ts` adds it, GETs included.
- **Accepted values:** a plain positive decimal integer. An empty value, whitespace, a sign, a fraction, `0`, leading zeros or a number too large to be exact is 400 `bad_request`.
- **Missing header:** accepted. curl, uptime checks and clients built before the header existed send none, and refusing them would break them for no gain. A browser app always sends it.
- **Too low:** a level below `MIN_API_LEVEL` is 426 `client_outdated`, checked before every other guard (`requireApiLevel` in `src/worker/http.ts`). A level above the Worker's is accepted.
- **Exempt:** `/api/health`, so a monitor works whatever it sends.
- **Live sockets** carry no `X-Api-Level` header, because a browser's WebSocket can't set one. The upgrade is checked like any other `/api/*` request, but a socket that is already open is not. What carries the check is the refetch the client makes on every open: it is an ordinary request with the header.
- **The client's reaction:** `call` turns a `client_outdated` answer into the failure `{type: "client_outdated"}` and sets the flag in `src/client/clientOutdated.ts`. The root layout then shows `UpdateRequired` (heading "Update to continue", one "Update now" button that calls `applyUpdate` from `useAppUpdate` in `src/client/appUpdate.ts`: it hands over to a waiting service worker and reloads, or, with none waiting, removes the service worker and the caches and reloads) in place of the routed page. Unmounting the page closes its live socket, so nothing keeps retrying.
- **Only add.** A change that keeps `API_LEVEL` may add an optional response field, a route or an error code, and nothing else. A client ignores a field it doesn't know. An error code it doesn't know becomes the failure `{type: "unknown_code", status, code}` with the generic message, and a live message of a shape it doesn't know still triggers a refetch.
- **Fixtures:** `src/shared/fixtures/level1/` holds a frozen sample of every message of level 1, and `src/shared/compat.test.ts` checks that the current schemas still parse them. The fixtures are append-only: never edit one to make a test pass.
- **Shipping a break:** raise `API_LEVEL`, add a `src/shared/fixtures/level2/` folder with the new messages (keep `level1/`, so the test still shows what changed), and set `MIN_API_LEVEL` to the new level only once old clients must be locked out. See "Raising `MIN_API_LEVEL`" in `deployment.md`.

## Suggestions

`POST /api/stories/:storyId/suggestions` returns three ways to continue the story. It reads the story and writes only its quota row: no story text, no turn change, no `turnVersion` bump, no live message. The request body is ignored (the `Content-Type` and Origin guards still apply).

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

`GET /api/stories/:storyId/live` upgrades to a WebSocket held by that story's `StoryRoom` Durable Object. The room holds no story data: D1 stays the only store.

- **Checks, in order:** `Upgrade: websocket`, any case (else 426), the Origin rule under "Guards" (403 `forbidden_origin`), ID shape and story (404 `not_found`), the caller is a participant (403 `not_participant`; 401 `invalid_session_token` for a bad session token). Only then is the request forwarded to the room.
- **Message:** the room sends the JSON text `{"version": <turnVersion>}` (`liveMessageSchema` in `src/shared/api.ts`) to every socket of the story after each join, rejoin, leave, contribution and skip. The version is the turn version the write produced. Create sends nothing: nobody can be connected yet. A client refetches on any message that is JSON text, whatever its shape, so a message kind from a newer Worker still triggers a refetch. It ignores text that isn't JSON and binary frames, and does not need the version.
- **Notify:** routes call `notifyRoom` (`src/worker/live.ts`) after the D1 write succeeds. It hands the room's `notify` RPC call to `waitUntil` and returns at once, so a slow or hung room can't delay a committed write. A failure is logged and swallowed, never turned into an error response: clients catch up on their next refetch or reconnect. Browsers can't call `notify`; they only reach the room's `fetch` (the upgrade) through the guarded route.
- **Client:** the live logic in `src/client/live.ts` says when to refetch: on every open, every JSON message and a second after `turn.endsAt` (a turn that times out sends no message). `useStoryLive` mounts it on the story page. The socket sends no `X-Api-Level`; the refetch on open does (see "Versioning").
  - The `endsAt` timer re-arms every 5 seconds until `endsAt` changes, because a client clock ahead of the server's would otherwise fire early and never try again.
  - Reconnects back off from 0.5 s to 30 s. The backoff restarts only after a socket stays open 10 s or delivers a live message, so a server that accepts and drops the socket is retried ever more slowly.
  - A `ping` every 25 s; no `pong` within 10 s marks the socket dead and reconnects.
  - The client opens a socket only on a joined participant's story page (a non-participant's upgrade is a 403).
- **Turn timeout:** `notifyRoom` also gives the room the saved turn's deadline (`turnEndsAt`, or null while the story waits), the story ID and the request's origin. `notify` stores the ID and origin under the `turnTimer` storage key and sets the alarm to the deadline, or deletes it when there is none. One alarm per story, so each write replaces the last.
  - **When the alarm fires,** `alarm()` calls `passTimedOutTurn` (`src/worker/turnTimeout.ts`). It re-reads the story from D1 and applies `resolveTurn` at the current time; the alarm's own fire time is never trusted.
  - **If the turn passed,** it saves the new turn under the same version guard as a write, then pushes "your turn" to the new holder with `pushToHolder`, unless the turn came back to the same person. The room then sends the new version to every socket and arms the next deadline. Push rules and failures are as under "Web Push".
  - **Safe to repeat:** a second fire, a fire before the deadline (the alarm is re-armed for the real one), a story that waits, and a write that wins the version guard first all save and push nothing. After a lost race the room arms the deadline the winning write left.
  - **Failures:** a push failure is logged. Any other failure (D1 down, bad stored timer) throws, and the runtime retries the alarm.
- **Hibernation:** the room uses the hibernation API. `ping` is answered by the runtime with `pong` without waking the object.
- **Subprotocols carry the session token.** A browser's WebSocket can't set an `Authorization` header, so a signed-in client offers `["andthen-live", <session token>]` (`LIVE_SUBPROTOCOL` and `liveSubprotocolsFor` in `src/shared/liveSubprotocol.ts`). An anonymous browser offers `["andthen-live"]` and the cookie decides. A store app sets headers on its socket, so it sends `X-Device-Token` (or `Authorization`) and no `Origin`. The Worker reads the token from the offered entries, cuts it from what it forwards to the room (`upgradeRequestForRoom`) and answers `andthen-live` alone (`upgradeResponseHeaders`), because a browser closes a socket whose answer is not one it offered. The client fetches a token for each connection, so a reconnect never offers an expired one.
- **Identity is read at the upgrade only.** An open socket is not rechecked, and a session token lasts about a minute. A writer who leaves keeps their sockets, so they go on receiving version numbers (nothing else is sent) until the socket closes; a refetch then answers 403 `left_story`. Closing them would need the room to tag sockets by participant, which it does not do.

## Web Push

A browser that allows notifications is told when a change hands it the turn. This section is the server's half. The app's half is `src/client/turnAlerts.ts` (see "How the app uses these routes" below) and the service worker's handlers in `src/client/pushHandlers.ts`.

- **One subscription per endpoint, for every story.** `push_subscriptions` is keyed on the push service's `endpoint` and carries the owner's `user_id`, so one subscription covers every story that user is in. A user may hold several (one per device, profile or push service), so a signed-in user is pushed on all their devices.
- **Subscription ID:** `pushSubscriptionId` in a path is the SHA-256 of the subscription's endpoint as 64 lowercase hex characters (`pushSubscriptionIdOf` in `src/shared/pushSubscriptionId.ts`, which the Worker and the browser both use). The ID reveals nothing the endpoint does not, and a client can make it before the first request.
- **`PUT /api/push-subscriptions/:pushSubscriptionId`:** body `{endpoint, keys: {p256dh, auth}}`, which is what `PushSubscription.toJSON()` returns (other fields, such as `expirationTime`, are ignored; `pushSubscriptionSchema`). Saves it for the requesting user and answers 204. The endpoint must be `https`, at most 2048 characters, and on a known push service host: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, or a subdomain of `push.apple.com` or `notify.windows.com`. Any other host, a port, or userinfo in the URL is 400 `bad_request`, so the Worker cannot be made to post to other sites. To support a new push service, add its host to `PUSH_SERVICE_HOSTS` or `PUSH_SERVICE_HOST_SUFFIXES` in `src/shared/api.ts`. `p256dh` and `auth` must be unpadded base64url of the length a browser produces (87 and 22 characters).
  - **Same endpoint again:** an upsert. The keys and owner are replaced and `created_at` keeps its first value, so a browser that resubscribes, or a second browser that registers the same endpoint, takes it over.
  - **No user:** the request names no user (no session token, and no cookie that matches one). Nothing is saved and no cookie or user is created. The route deletes any row for that endpoint and answers 204, because a session that ended on another device should stop pushing to this one on the next load. The client waits for its session to load before it sends this, so a signed-in device is not mistaken for an anonymous one.
  - **Rejected session token:** 401 `invalid_session_token`, and the row is kept. A rejected token never falls back to the cookie.
  - **Order of checks:** the guards in "Guards", then the body (400 `bad_request`), then that the ID in the path is the hash of the body's endpoint (400 `bad_request`), then who is asking.
- **`DELETE /api/push-subscriptions/:pushSubscriptionId`:** no body (a body is 400 `bad_request`). Removes the requesting user's own subscription whose endpoint has that ID and answers 204 whether or not one was stored. An ID that is not 64 lowercase hex characters is 404 `not_found`. Another user's subscription is never touched. A request that names no user owns nothing, so it gets 204 and no cookie.
- **`GET /api/push-key`:** `{publicKey}`, the VAPID public key (87 base64url characters) for `pushManager.subscribe({applicationServerKey})`. It needs no identity and reads only `VAPID_PUBLIC_KEY`, so it works before the private key is set. A missing or malformed key is 500 `internal_error`.
- **Who is pushed.** After each join, rejoin, leave, contribution and skip is saved, `notifyTurnHolder` (`src/worker/turnPush.ts`) compares the turn before and after with `turnPassedTo` (`src/shared/turnOrder.ts`).
  - A push goes to every subscription of the user of the writer who newly holds the turn.
  - No push when the same person keeps the turn, when the story goes to waiting, or when the new holder is the requester (a joiner or rejoiner who takes a waiting story).
  - "Before" is the stored turn with expiry applied (`resolveTurn`). If the holder's window had already lapsed, an unrelated change such as a join does not count as handing the turn to the person it had already moved to. A turn that only lapses is handled by the room's alarm; see "Turn timeout" below.
  - A requester's position is the one in the saved turn order. A joiner or rejoiner takes a new position at the end, so it is not `me.position`.
- **Sending.** The work runs under `waitUntil`, like `notifyRoom`: it never delays or fails the response, and a failure is logged. The holder's subscriptions and the story's opening are read in the background, and the sender (`selectPushSender` in `src/worker/push.ts`, which needs `VAPID_PRIVATE_KEY`) is built only when there is a subscription to send to. A missing or bad key is logged as "Turn push failed" and the write is unaffected.
  - **Outcomes:** the push service answers 2xx (delivered), 404 or 410 (the subscription is gone, so it is deleted), or anything else (logged with the push service's host, never the endpoint; the subscription is kept). A network error is logged and counts as failed.
  - **Payload,** encrypted for the browser (RFC 8291, `aes128gcm`) and signed with VAPID (RFC 8292): the declarative Web Push shape, which Safari shows by itself and other browsers pass to the service worker's `push` handler.
    ```json
    {
      "web_push": 8030,
      "notification": {
        "title": "Your turn",
        "body": "Once upon a time, in a village by the sea, a lantern went…",
        "navigate": "https://app.andthen.page/abc12",
        "tag": "turn-abc12"
      }
    }
    ```
    `body` is the start of the story's opening: whitespace collapsed to single spaces, at most 60 characters, cut at a word and ended with `…` when shortened. `navigate` uses the origin of the request that made the change. `web_push` is the number 8030.
  - **Headers:** `Topic: turn-<storyId>` (a newer message for the story replaces an undelivered older one), `Urgency: high`, and `TTL` the seconds left in the new holder's turn window, never under 60.
- **Config:** `VAPID_PUBLIC_KEY` (a var in `wrangler.jsonc`, per environment) and `VAPID_PRIVATE_KEY` (a Worker secret) are parsed with Zod by `parseVapidConfig` and `parseVapidPublicKey` in `src/worker/config.ts`. The subject is the constant `VAPID_SUBJECT`. The private key is not in the generated `Env` type, because `wrangler types` runs in CI without secrets. `docs/deployment.md` says how to make and set the keys.
- **Only added:** no `API_LEVEL` bump. The routes are new and no existing message changed.

### How the app uses these routes

All three calls go through `src/client/api.ts` (`fetchPushKey`, `savePushSubscription`, `removePushSubscription`), so a failure comes back as a value.

- **Turning on** (the "Notify me when it's my turn" switch in the story rail): the page asks for notification permission first, because browsers allow the prompt only inside the user's tap. It then calls `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})` with the key from `GET /api/push-key`, parses `toJSON()` with `pushSubscriptionSchema` and `PUT`s it. The key is fetched when the app loads, while permission is still undecided, so the tap goes from the prompt to subscribing with no network wait. If the `PUT` fails, or the browser's subscription is not one the schema accepts, the page unsubscribes in the browser again, so the browser never holds a subscription the Worker doesn't know. A browser that cannot subscribe (Brave with "Use Google services for push messaging" off throws here) shows an error and stays off.
- **Turning off:** the page unsubscribes in the browser, then `DELETE`s the endpoint. If only the `DELETE` fails, the switch still shows off: the browser no longer receives pushes, and the Worker deletes its copy the next time a push to that endpoint answers 404 or 410.
- **On every app load** (`startTurnAlerts` in `src/app/_layout.tsx`), if notifications are allowed and the browser holds a subscription, the page `PUT`s it again, so a Worker that lost the row is brought back in step. A failure is ignored; the next load tries again. A page that names no user gets 204 and the Worker drops the endpoint's row (see "No user" above).
- **No Push API.** iOS and iPadOS Safari has the Push API only for an app added to the Home Screen (16.4 and later). In a browser tab the page shows "Add to Home Screen to get notified" instead of the switch. Where the browser has no service worker or Push API at all, and in a development build (which registers no service worker), the switch is absent.
- **The service worker** shows the payload with `showNotification`, using the payload's `tag` so a newer notification for the story replaces an older one, and on a tap focuses a tab already on `navigate` or opens it. It ignores a message that does not parse as `turnPushPayloadSchema`, and never opens an address outside its own origin.

## Cookie

`__Host-andthen_bt` (HttpOnly, Secure, SameSite=Lax, Path=/, 1 year) everywhere except `http://localhost`, where it is `andthen_bt` without `Secure`. The value is 32 random bytes in hex; only its SHA-256 hash is stored, in `users.browser_token_hash`. `readDeviceToken` (`src/worker/cookies.ts`) returns null for no cookie, which matches no user; it reads the cookie only when the request has no `X-Device-Token` header. A user who attaches an account loses the hash, so the cookie names no user from then on.

## Writes and races

Each write is one `db.batch()`. Every statement is guarded by `turn_version = <loaded version>`, so a write that lost a race changes nothing and the route answers 409 `stale_turn`. A join or contribution inserts its row _before_ the story update, so both test the same unchanged snapshot. Unique constraints (`display_name_key`, and one active participant per user per story) are a backstop only: routes check names and users against the loaded participants first, and any change to those rows bumps the version.

Story creation retries with a new ID when the ID is taken (up to `STORY_ID_ATTEMPTS`). A failed create batch leaves nothing behind (it is atomic), so `createStory` asks `SELECT 1 FROM stories WHERE id = ?` to tell a collision from any other error. It does not read the constraint error text, whose wording differs between Miniflare and real D1 and is untested against real D1.

## Testing

- `createApp({ now, newStoryId, suggestionProvider, pushSender, sessionVerifier, minApiLevel })` in `src/worker/app.ts` takes the clock, the ID source, a function from `env` to a `SuggestionProvider`, a function from `env` to a `PushSender`, a function from `env` to a `SessionVerifier` (`selectSessionVerifier` in the real app) and, optionally, the minimum API level (`MIN_API_LEVEL` by default), which a test raises to get `client_outdated`. `app` is the real-clock default; `index.ts` re-exports it.
- `test/support/browser.ts`: `createTestApp(clock, newStoryId?, suggestionProvider = fakeProvider, minApiLevel?, pushSender = createFakePushSender())` and `createBrowser(app, env)`, a browser with its own cookie jar (`get`, `post`, `put` and `delete`) that sends a same-origin `Origin`, `Content-Type: application/json` and the current `X-Api-Level` by default. Its request options take `apiLevel`: a string to send instead, or `null` to send no header. Build a `Browser` with an `https://app.andthen.page` origin to get the `__Host-` cookie. Set its `sessionToken` to make it send `Authorization: Bearer <token>` on every request, as a signed-in client does, or its `deviceToken` to send `X-Device-Token`. `createPhone(app, env, deviceToken?)` is a store app: it sends the header and no `Origin`, and drops every `Set-Cookie`, so assert on the response to see whether one was sent. `newDeviceToken()` makes a token of the right shape.
- `test/support/sessionToken.ts`: `signSessionToken(clerkUserId, origin, options?)` signs a token with a key made for the test run, and `TEST_JWT_KEY` is its public half. `options` takes `expiresInSeconds` (negative for an expired token), `omitAuthorizedParty` (leaves out `azp`) and `signWithOtherKey`. `createTestEnv` (`test/support/testEnv.ts`) sets `CLERK_JWT_KEY` to `TEST_JWT_KEY`, so the real verifier runs in the tests. A token's `origin` must equal the origin the browser sends to.
- `test/live.test.ts`: the live guard and `notifyRoom` calls in Node, with a stand-in `STORY_ROOM` passed as `env` (Node can't build a 101 response, so its `fetch` answers 200). A browser's `backgroundWork` holds what the app gave `waitUntil`.
- `test/storyRoom.workerd.test.ts`: the real Worker and `StoryRoom` in workerd through wrangler's `createTestHarness`, with real WebSockets. It reads `wrangler.jsonc` and drops `assets` (which needs a built `dist/`). `index.ts` and `storyRoom.ts` aren't mutated by Stryker, so this is their only coverage.
- `test/support/fakePushSender.ts`: `createFakePushSender()` records every `send` in `sent` and answers `delivered` unless `outcomes` or `throwing` says otherwise. `test/turnPush.test.ts` uses it to check who is pushed. The real sender is tested in `src/worker/push.test.ts` against the real encryption library, with an injected `fetch`.
- `test/support/gatedDb.ts`: `gateLoads(db, n)` holds `n` concurrent requests at their story load until all have loaded, so they race on one stored version. Pass it as `{ env: { DB: gateLoads(...) } }` in the request options.
- A route that touches no D1 can be tested with a stand-in `DB`: repo functions take `Db`, a `Pick<D1Database, "prepare" | "batch">`.
