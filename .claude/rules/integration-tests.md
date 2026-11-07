---
paths:
  - "test/**"
  - "src/worker/**/*.integration.test.ts"
---

# Worker integration test rules

An integration test calls the Hono app against Miniflare with an in-memory D1 (`createTestEnv`, `createBrowser`). Miniflare starts once per file, and each test costs about 165 ms. `testing.md` holds the rules for every test.

- **A route's tests prove the wiring**:
  - the success status and the stored result
  - one test per error code, proving the code reaches the client with its status from `ERROR_STATUS`, and that the guard in front of it runs
  - races and D1 behaviour that no unit test can see
- **The rule behind an error is a unit test.** Variants such as a stale turn, skipping yourself or a leave that passes the turn are tested in `src/shared/turnOrder.test.ts` and its neighbours. The route test triggers one case.
- **A test can hold several act and assert rounds** on one assembled story. Creating a story and joining writers is the expensive part, so one test walks a story through its steps and asserts after each.
- **One file per route module**, named `<module>.integration.test.ts`. A new file pays another Miniflare start-up. The name is what loads these rules and keeps `unit-tests.md` away.
