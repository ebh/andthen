# Persisting turn state

`src/shared/turnOrder.ts` decides whose turn it is. It never reads the clock or storage. These rules keep D1 and the turn rules in step.

## The guard

- Load the `stories` row and the participants' positions. Pass that state, as loaded, to `afterContribution`, `skip` or `onJoin`, with the server's `now`.
- The action resolves expiry itself and compares the client's `turnVersion` with the **resolved** version. A mismatch is `stale_turn` (409).
- Persist the returned state with `WHERE id = ? AND turn_version = <loaded version>`. Use the version you **loaded**, not the one in the returned state. `meta.changes = 0` means another write won: answer 409.
- After k elapsed windows, the client's version is the loaded version plus k. The returned state carries loaded + k + 1.
- Persisting a partly resolved expiry is safe. Resolving at t1 and then at t2 gives the same state as resolving once at t2.

## Reads

- Build the story view from `resolveTurn(loaded, now).state`, never the raw row. The raw row shows the old holder and a past `endsAt` once a turn has expired, and the client's timer would fire at once.
- Reads write nothing.

## Every change bumps the version

Each contribution, skip, expired window and join adds one to `turn_version`. A join to a waiting story also starts the turn, but the version still goes up once. So any action that loaded the participant list before a join fails the guard. That includes a contribution the holder was typing, so the composer must keep its text when it gets a 409.

## Left for later phases

- **Phase 3:** cap the request body size before validation runs.
- **Out of scope:** passages and names made only of zero-width or filler characters (e.g. U+200B, U+3164) pass validation. `trim()` doesn't remove them, and each counts as a grapheme.
