---
paths:
  - "migrations/**"
  - "src/worker/db/**"
  - "src/worker/cookies.ts"
  - "src/worker/sessionToken.ts"
  - "src/worker/suggestions/**"
  - "src/worker/push.ts"
  - "src/worker/turnPush.ts"
  - "src/worker/turnNotification.ts"
  - "src/client/sessionToken.ts"
  - "src/shared/api.ts"
  - "wrangler.jsonc"
  - "package.json"
  - "public/index.html"
---

# Legal impact rules

The legal documents describe what the app does. These files decide what it stores, sends and loads, so a change here can make a document false. `legal-documents.md` says how to change one.

- **A change to what is stored, how long, who receives it or which third party handles it affects the privacy policy.** Examples: a new column or table, a new cookie or stored token, a deletion or retention change, a new dependency that loads on a page, a new `wrangler.jsonc` binding, text sent to the AI, a push payload.
  - So does a change to who can see stored data, such as a name shown in every story instead of one.
  - So does a migration that changes or links data people gave under an earlier version, because the older text no longer describes it.
- **A change to posting, reporting or who may use the app affects the terms of service.** Examples: a new way to post, a report or moderation path, the minimum age.
- **A change to how passages may be used affects the copyright terms.** Examples: a new kind of contribution, or a new way a passage is shown or sent out of the app.
- **The pull request adds a new version of each affected document, or says in its description why none is needed.** A reviewer cannot see a document gone false in the diff, so the description carries the decision.
