---
paths:
  - "src/**/*.test.ts"
  - "src/**/*.test.tsx"
  - "test/**"
  - "e2e/**"
---

# Testing rules

The test pyramid: many fast unit tests, fewer and slower tests at each level above. These rules apply to every test. The level-specific files add to them: `unit-tests.md`, `component-tests.md`, `integration-tests.md`, `e2e-tests.md`. `testability.md` covers the source code under test.

## Pick the lowest level that can see the behaviour

| The behaviour is                                                                              | Level                        |
| --------------------------------------------------------------------------------------------- | ---------------------------- |
| A rule, branch, format or calculation                                                         | Unit test of a pure function |
| What a person sees and does on one screen                                                     | Component test               |
| An HTTP status, a guard, a D1 write or a race                                                 | Worker integration test      |
| Only a real browser shows it: the live socket end to end, the service worker, real CSS layout | E2E test                     |

A behaviour is tested once, at that level. A higher level checks only that it is wired to the lower one, with one happy-path assertion.

## Cost decides how many

Stryker reruns every test that covers a mutant, once per surviving mutant, so test time is Stryker time. Measured per test: a unit test about 1 ms, a Worker integration test about 165 ms, a component test about 270 ms.

- A new slow test replaces or merges with an existing one that covers the same ground. Delete the one it supersedes in the same change.
- Reach for a unit test first. Move the logic out of the slow layer when that is what it takes (`testability.md`).

## Where a test lives

- A test sits beside the file it tests: `foo.ts` has `foo.test.ts`, `Foo.tsx` has `Foo.test.tsx`.
- An integration test sits beside the route module it exercises, one file per module. Each file starts Miniflare once, and that start-up is the cost of the file.
- Integration tests not yet moved are still in `test/`.
- E2E tests are in `e2e/`, because they test the whole app.

## Test comments

A test comment says what the test pins and what breaks if the test is removed. A workaround for a known bug links its issue.
