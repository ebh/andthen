---
paths:
  - "e2e/**"
---

# E2E test rules

An e2e test drives the built app in Chromium against `wrangler dev`. It is the slowest level, and CI runs each one on every push. `testing.md` holds the rules for every test.

- **One happy-path test per user journey.** A journey is a sequence a person completes, such as starting a story, taking turns and leaving. Name the journey in the test title.
- **Test only what no lower level can see**: the live socket from a real browser to the screen, the service worker, the push contract with the Worker, real CSS layout and scrolling.
- **Error, validation and empty states have lower-level tests.** An e2e test for one needs a reason in a comment that only a real browser shows it.
- **Before adding a test, name the journey or browser behaviour that no other spec covers.** When an existing spec nearly covers it, extend that spec with another step.
- **A `ui.md` change is done when `pnpm e2e` passes.** It does not get its own new e2e test.
