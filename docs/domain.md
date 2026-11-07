# Domain terms

The words this app uses, each with one meaning. `.claude/rules/naming.md` says how to add a word.

## Story and its text

- **Story:** one text that a group writes together, in turns. It has a five-character ID that is also its URL (`/<id>`). Lives in the `stories` table; routes under `/api/stories`.
- **Passage:** a section of a story's text. It can be part of a sentence, a sentence or a whole paragraph, up to `MAX_PASSAGE_LENGTH` (280 graphemes) in `src/shared/validation.ts`. The error code is `invalid_passage`.
- **Opening:** the first passage of a story, written by its creator when they start it. `opening` in `StorySummary`.
- **Paragraph start:** whether a passage opens a new paragraph or continues the last one. `startsParagraph` in `ContributionView`; the opening always starts one.
- **Contribution:** what a participant adds to a story. Today every contribution is a passage, because nothing else can be added yet. Edits, comments and votes are planned and will be contributions too (see "Reserved"). Lives in the append-only `contributions` table; `ContributionView` in `src/shared/api.ts`; `POST /api/stories/:id/contributions`.
- **Author:** the participant who wrote a contribution. `authorId` and `authorName` in `ContributionView`.
- **Contributor:** a participant who has made at least one contribution of any kind: a passage today, later an edit, comment or vote. It is the author link seen from the participant's side. The last contributor is the participant who made the most recent contribution; the turn passes over them (`lastContributorPosition`).
- **Suggestion:** an AI-written passage offered to the turn holder. A request returns three; they only fill the text box, and the participant decides what to send. Limited to `SUGGESTION_LIMIT` per participant per hour. `POST /api/stories/:id/suggestions`.

## People

- **User:** one person across stories. A participant and a push subscription each belong to a user. A user is anonymous until it has an account. Lives in the `users` table.
- **Participant:** someone who has joined a story. One row per user per story in the `participants` table; `ParticipantView`; `POST /api/stories/:id/participants`. The same person in two stories is two participants.
- **Writer:** a participant who may write passages. Today every participant is a writer, so the role is not stored. A writer is the author of the passages they write. The word appears in the README, the docs, UI copy and `writerCount` in `StorySummary`.
- **Display name:** the name shown beside a participant's passages. Chosen per story, up to `MAX_DISPLAY_NAME_LENGTH` (40 graphemes), unique in a story ignoring case (`display_name_key`). A leaver's name stays reserved.
- **Invite link:** a story's URL, shared so others can join. Anyone with it can join, up to `MAX_PARTICIPANTS` (50).
- **Browser token:** the random cookie `__Host-andthen_bt` (`andthen_bt` on `http://localhost`) that identifies an anonymous user. Only its SHA-256 hash is stored, as `users.browser_token_hash`. A user with an account has no browser token.
- **Device user:** the user that this device's browser token names. A device user is always anonymous, because attaching an account clears the user's browser token. After sign-in, the device user is added to the account: the account is attached to it, or it merges into the user that already holds the account (see "Merge"). `addDeviceUserToAccount`.
- **Account:** a sign-in that a user can hold, so the same person reaches their stories from any device. It is optional: the app works without one. Stored as `users.clerk_user_id`. The sign-in page is `/sign-in`. A user with an account has no browser token, so the account, not the browser, decides who they are.
  - **Signing in:** the first time an account signs in on a device, the account is attached to that device's user. The stories the device already had stay, and the user now has an account. When the account already belongs to another user, the two merge (see "Merge").
  - **Signing out:** the device is anonymous again. Its stories are not on it any more, because they belong to the account. Signing out first switches off turn notifications on that device.
  - **In the app:** the home page shows "Use your stories on all your devices" with a "Sign in" link to `/sign-in`. A signed-in user sees their email and a "Sign out" button.
  - `PUT /api/users/me/account`.
- **Merge:** folding the device user into the user that holds the account (the account user). Participants and push subscriptions move to the account user, and the device user is deleted. Only the basic fold ships. When both users are writers in the same story, the device user's participant leaves that story first, and the left row stays tied to the account user. Joining those two participants into one stays in [#48](https://github.com/ebh/andthen/issues/48).
- **`me`:** the reserved user ID in a path that means the user making the request, as in `/api/users/me/account`. See `.claude/rules/api.md`.
- **Session token:** the short-lived proof that a request comes from a signed-in account. A signed-in client sends it as `Authorization: Bearer <token>` on every call. The Worker checks it (`src/worker/sessionToken.ts`). A request with a session token never falls back to the browser token. Error code `invalid_session_token`.
- **My stories:** the stories a user is in and has not left, on every device that user is signed in on. `GET /api/stories`; `StorySummary`.
- **Leave and rejoin:** leaving sets `participants.left_at` and keeps the row, so passages keep an author and the name stays reserved. Rejoining clears it and puts the participant last in the turn order. `POST /api/stories/:id/leave` and `/rejoin`.

## Turns

- **Turn order:** the participants who are still in a story, in ascending `position`. It wraps: after the last participant the turn goes back to the first. `src/shared/turnOrder.ts`.
- **Turn:** the right to add the next passage. One participant holds it at a time.
- **Turn holder:** the participant whose turn it is. `holderId` and `holderName`; null while the story is waiting.
- **Waiting:** a story with no turn holder and no timer. It happens when its only participant wrote last, or when nobody is left in it. It waits until someone joins.
- **Turn window:** how long a holder has, `TURN_WINDOW_MS` (24 hours). When it ends the turn moves on, checked lazily on the next read or write, and by the `StoryRoom` alarm for the push.
- **Turn version:** `turnVersion`, a counter that goes up by one for each contribution, skip, expired window, join and leave. A request that carries an old one fails with `stale_turn`.
- **Skip:** any participant but the holder passes the turn to the next one. `POST /api/stories/:id/skip`.

## Live and background

- **Live update:** a message from the story's WebSocket telling clients to refetch. `GET /api/stories/:id/live`; `liveMessageSchema`.
- **StoryRoom:** the Durable Object that fans out live updates and runs the turn window alarm. It holds no story data; D1 does.
- **Push subscription:** a browser's Web Push endpoint, used to say "it's your turn". Belongs to a user, not a story. `/api/push-subscription`.
- **API level:** the whole number in `src/shared/apiLevel.ts` that a client sends as `X-Api-Level`. Raised only for a change that breaks shipped clients. A client below `MIN_API_LEVEL` gets 426 `client_outdated`.

## Reserved

Words kept for planned features. None exists in the code yet. Each links to the issue that holds the idea. If a reserved word fits something new, ask the owner whether to keep reserving it before using it.

- **Role:** what a participant may do in a story: reader, writer, editor, admin, voter or commenter. All but possibly admin are participants. [#49](https://github.com/ebh/andthen/issues/49)
- **Organisation:** a group of users, such as a company running a team exercise. [#50](https://github.com/ebh/andthen/issues/50)
- **Block:** one user hides another user's content. [#51](https://github.com/ebh/andthen/issues/51)
- **Edit:** a contribution that changes a passage. [#52](https://github.com/ebh/andthen/issues/52)
- **Comment:** a contribution that discusses a passage. [#53](https://github.com/ebh/andthen/issues/53)
- **Vote:** a contribution that states a preference about a passage. [#54](https://github.com/ebh/andthen/issues/54)
