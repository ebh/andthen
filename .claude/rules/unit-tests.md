---
paths:
  - "src/**/*.test.ts"
  - "!src/**/*.integration.test.ts"
---

# Unit test rules

A unit test checks one pure function or one small module with no browser, network or database. Unit tests are the base of the pyramid and carry most of the coverage. `testing.md` holds the rules for every test.

- **Many and small.** One arrange, one act, one assert per test. Name the case in the test title.
- **Every branch and boundary is covered here**, including each variant of a rule: a stale turn, skipping yourself, an empty list, the limit and one past it.
- **Variants are `it.each` rows**, so a new case is one line.
- **A failure is a value to assert on**, so tests read the returned failure, not a thrown message.
- **Fakes are injected** (a clock, a fetch, a fake socket). A test needs no module mock for a dependency the function takes as an argument.
