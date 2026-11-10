# Domain terms

The words this app uses, each with one meaning. `.claude/rules/naming.md` says how to add a word.

## Story and its text

- **Story:** one text that a group writes together, in turns. It has a five-character ID that is also its URL (`/<id>`). Lives in the `stories` table; routes under `/api/stories`.
- **Passage:** a section of a story's text. It can be part of a sentence, a sentence or a whole paragraph, up to `MAX_PASSAGE_LENGTH` (280 graphemes) in `src/shared/validation.ts`. The error code is `invalid_passage`. Lives in the append-only `passages` table; `PassageView` in `src/shared/api.ts`; `POST /api/stories/:storyId/passages`.
- **Opening:** the first passage of a story, written by its creator when they start it. `opening` in `StorySummary`.
- **Paragraph start:** whether a passage opens a new paragraph or continues the last one. `startsParagraph` in `PassageView`; the opening always starts one.
- **Contribution:** what a user adds to a story. Today every contribution is a passage, because nothing else can be added yet. Edits, comments and votes are planned and will be contributions too (see "Reserved"). Each kind gets its own table, as passages do; there is no `contributions` table.
- **Author:** the user who wrote a passage. `authorId` (the user's ID, the same in every story) and `authorName` in `PassageView`; `authorId` is `passages.author_id`. For who shares in a story's copyright, see Passage author.
- **Contributor:** a user who has made at least one contribution of any kind: a passage today, later an edit, comment or vote. The last contributor is the participant whose user made the most recent contribution; the turn passes over them (`lastContributorPosition`).
- **Suggestion:** an AI-written passage offered to the turn holder. A request returns three; they only fill the text box, and the participant decides what to send. Limited to `SUGGESTION_LIMIT` per participant per hour. `POST /api/stories/:storyId/suggestions`.

## People

- **User:** one person across stories. A passage, a participant and a push subscription each belong to a user, and so does the display name. A user is anonymous until it has an account. A user with an account is an account user. Lives in the `users` table.
- **Participant:** someone who has joined a story. One row per user per story in the `participants` table; `ParticipantView`; `POST /api/stories/:storyId/participants`. The same person in two stories is two participants.
- **Writer:** a participant who may write passages. Today every participant is a writer, so the role is not stored. A writer's user is the author of the passages they write. The word appears in the README, the docs, UI copy and `writerCount` in `StorySummary`.
- **Display name:** the name shown beside a user's passages, in every story. A user chooses it once, when they start or join their first story. Up to `MAX_DISPLAY_NAME_LENGTH` (40 graphemes), unique among all users ignoring case (`users.display_name_key`). Sending a name when the user already has one is refused, because a rename would rewrite the name on every old passage. `GET /api/users/me` reports it.
- **Invite link:** a story's URL, shared so others can join. Anyone with it can join, up to `MAX_PARTICIPANTS` (50).
- **Device token:** the random secret that identifies an anonymous user on one device: 32 random bytes as 64 lowercase hex characters (`deviceTokenSchema`). A browser carries it in the browser token cookie; a store app makes it on first launch, keeps it in secure storage and sends it as the `X-Device-Token` header. Only its SHA-256 hash is stored, as `users.browser_token_hash`. A user with an account has no device token.
- **Browser token:** the cookie `__Host-andthen_bt` (`andthen_bt` on `http://localhost`) that carries the device token on the web. The Worker issues it. The code still says "browser token" in places (`hashBrowserToken`, `users.browser_token_hash`).
- **Device user:** the user that this device's device token names. A device user is always anonymous, because attaching an account clears the user's device token. After sign-in, the device user is added to the account: the account is attached to it, or it merges into the user that already holds the account (see "Merge"). `addDeviceUserToAccount`.
- **Account:** a sign-in that a user can hold, so the same person reaches their stories from any device. It is optional: the app works without one. Stored as `users.clerk_user_id`. The sign-in page is `/sign-in`. A user with an account has no browser token, so the account, not the browser, decides who they are.
  - **Signing in:** the first time an account signs in on a device, the account is attached to that device's user. The stories the device already had stay, and the user now has an account. When the account already belongs to another user, the two merge (see "Merge").
  - **Signing out:** the device is anonymous again. Its stories are not on it any more, because they belong to the account. Signing out first switches off turn notifications on that device.
  - **In the app:** the home page shows "Use your stories on all your devices" with a "Sign in" link to `/sign-in`. A signed-in user sees their email and a "Sign out" button.
  - `PUT /api/users/me/account`.
- **Merge:** folding the device user into the account user. Passages, participants, blocks and push subscriptions move to the account user, and the device user is deleted. A block that would duplicate one the account user already holds, or would make the account user block themselves, is dropped. The account user keeps its display name and takes the device user's only when it has none. Only the basic fold ships. When both users are writers in the same story, the device user's participant leaves that story first, and the left row stays tied to the account user. Joining those two participants into one stays in [#48](https://github.com/ebh/andthen/issues/48).
- **Block:** one user hides another user's passages from the blocker only, in every story. A block points from user to user, never at a participant, so the blocker sees that user's passages hidden wherever they write. Each user has one list of blocks, and the client matches it against each passage's `authorId`. The blocked user is not told, and can still write and hold turns. A user can undo a block, and unblocking is one tap with no confirm. Unblocking is the usual way to delete a block. A merge also deletes a block that would be a duplicate or would make a user block themselves. Lives in the `blocks` table; `GET` and `POST /api/users/me/blocks`; `DELETE /api/users/me/blocks/:blockId`. [#51](https://github.com/ebh/andthen/issues/51)
- **Obscured:** a passage whose author the user has blocked, shown as a blurred stand-in the same length as the real text. A press shows the real text until the passage leaves the screen (its `Turn` unmounts) or the author's block changes. The openings in Your stories and on the Rejoin page have no press. Showing it does not unblock the author. Known limit: until the list of blocks has loaded, or if it fails to load, every other author's passage and every opening is shown as a stand-in, and the label then says they are hidden because you blocked them even though that may not be true yet. A proper loading look is planned in [#172](https://github.com/ebh/andthen/issues/172). Screen readers get a label, never the text: "Passage by <name>, hidden because you blocked them", or "Opening passage, hidden because you blocked its author" where the stand-in has no press.
- **`me`:** the reserved user ID in a path that means the user making the request, as in `/api/users/me/account`. See `.claude/rules/api.md`.
- **Session token:** the short-lived proof that a request comes from a signed-in account. A signed-in client sends it as `Authorization: Bearer <token>` on every call. The Worker checks it (`src/worker/sessionToken.ts`). A request with a session token never falls back to the browser token. Error code `invalid_session_token`.
- **My stories:** the stories a user is in and has not left, on every device that user is signed in on. Listed a page at a time. `GET /api/stories`; `StorySummary`.
- **Page:** the next batch of a user's stories, at most `limit` of them (`MY_STORIES_DEFAULT_LIMIT` 20, `MY_STORIES_MAX_LIMIT` 50). The response carries the cursor for the page after it, or null on the last page. `StoriesPage`.
- **Cursor:** where a page ended: the sort key of its last story (whose turn it is, newest passage time, story ID). It is opaque to clients, and the next page is every story that sorts after it. `nextCursor`; `StoryCursor`.
- **Leave and rejoin:** leaving sets `participants.left_at` and keeps the row, so the turn order keeps its places and a rejoin finds the participant. Rejoining clears it and puts the participant last in the turn order. `POST /api/stories/:storyId/leave` and `/rejoin`.

## Turns

- **Turn order:** the participants who are still in a story, in ascending `position`. It wraps: after the last participant the turn goes back to the first. `src/shared/turnOrder.ts`.
- **Turn:** the right to add the next passage. One participant holds it at a time.
- **Turn holder:** the participant whose turn it is. `holderId` and `holderName`; null while the story is waiting.
- **Waiting:** a story with no turn holder and no timer. It happens when its only participant wrote last, or when nobody is left in it. It waits until someone joins.
- **Turn window:** how long a holder has, `TURN_WINDOW_MS` (24 hours). When it ends the turn moves on, checked lazily on the next read or write, and by the `StoryRoom` alarm for the push.
- **Turn version:** `turnVersion`, a counter that goes up by one for each contribution, skip, expired window, join and leave. A request that carries an old one fails with `stale_turn`.
- **Skip:** any participant but the holder passes the turn to the next one. `POST /api/stories/:storyId/skip`.

## Live and background

- **Live update:** a message from the story's WebSocket telling clients to refetch. `GET /api/stories/:storyId/live`; `liveMessageSchema`.
- **StoryRoom:** the Durable Object that fans out live updates and runs the turn window alarm. It holds no story data; D1 does.
- **Push subscription:** a browser's Web Push endpoint, used to say "it's your turn". Belongs to a user, not a story. Its ID is the hash of its endpoint. `/api/push-subscriptions/:pushSubscriptionId`.
- **VAPID public key:** the public half of the key pair the Worker signs pushes with (VAPID, Voluntary Application server Identification). A browser passes it to `pushManager.subscribe` so the push service knows who may send. It is the same for every user and is not a subscription. `GET /api/vapid-public-key`; `VapidPublicKeyResponse`.
- **Install:** adding the app to a device so it opens in its own window, like any other app. On iPhone and iPad the user does it with Add to Home Screen. Elsewhere the browser offers it (`beforeinstallprompt`) and the story page shows an "Install the app" button (`src/client/appInstall.ts`). An installed app is also called standalone in the code (`isInstalled`).
- **API level:** the whole number in `src/shared/apiLevel.ts` that a client sends as `X-Api-Level`. Raised only for a change that breaks shipped clients. A client below `MIN_API_LEVEL` gets 426 `client_outdated`.

## Legal documents

- **Legal document:** a text people agree to or are told about, kept as Markdown in `legal/<id>/v<n>.md` and registered in `LEGAL_DOCUMENTS` in `src/shared/legalDocuments.ts`. Its ID is its folder: `terms-of-service`, `privacy-policy` or `copyright-terms/<copyright model>`.
  - **Version:** one numbered text of a legal document, `{ version, effectiveOn }`. Versions run 1..n. A merged version is never edited; a change is a new version. `currentVersion`, `legalDocumentPath`.
- **Terms of service:** the rules for using andthen.page, including the licence that lets the app store, show and send the text of stories on. It applies to every story, whatever copyright model it uses. `legal/terms-of-service/`.
- **Privacy policy:** what personal information the app stores and sends, where, and for how long. `legal/privacy-policy/`.
- **Copyright terms:** the deal between the writers of a story about who may use the story's text. One copyright model per folder, `legal/copyright-terms/<model>/`.
- **Copyright model:** one set of copyright terms a story can follow. Today there is one, `equal-shares`: every passage author may use the whole story, and money from commercial use is split equally. A story will later pick a model. A change to what a model means is a new model, not a new version.
- **Passage author:** a person who wrote at least one passage in a story, including one who has left. Only passage authors hold authorship of the story for copyright; once edits, comments and votes exist, taking part in those ways will not make someone a passage author.

## Reserved

Words kept for planned features. None exists in the code yet. Each links to the issue that holds the idea. If a reserved word fits something new, ask the owner whether to keep reserving it before using it.

- **Role:** what a participant may do in a story: reader, writer, editor, admin, voter or commenter. All but possibly admin are participants. [#49](https://github.com/ebh/andthen/issues/49)
- **Organisation:** a group of users, such as a company running a team exercise. [#50](https://github.com/ebh/andthen/issues/50)
- **Edit:** a contribution that changes a passage. [#52](https://github.com/ebh/andthen/issues/52)
- **Comment:** a contribution that discusses a passage. [#53](https://github.com/ebh/andthen/issues/53)
- **Vote:** a contribution that states a preference about a passage. [#54](https://github.com/ebh/andthen/issues/54)
