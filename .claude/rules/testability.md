---
paths:
  - "src/ui/**"
  - "src/client/**"
  - "src/worker/**"
  - "!src/**/*.test.ts"
  - "!src/**/*.test.tsx"
---

# Testability rules

Write source code so the logic in it is tested by fast unit tests. `testing.md` says which level tests what.

## Logic leaves components and hooks

A component or hook renders and wires. Branching on data, deriving state, choosing a message and classifying a result belong in a pure function in `src/client/` or `src/shared/`, with its own unit test.

- A component calls the function and renders what it returns. Its component test then checks the wiring once.
- A pure function takes its inputs as arguments. A clock, `fetch` or a browser API is passed in, not read from the global.
- A function a test needs is exported. A file-local rule that cannot be reached is a rule that is tested through the slowest layer.
- Two components that share a rule share the function. `JoinForm` and `Rejoin` classifying a join result is one rule.

Copy these existing pairs: `live.ts` with `useStoryLive.ts`, `turnAlerts.ts` with its hook, `appUpdate.ts` with its hook.

## Routes stay thin

A Worker route parses the request, calls a pure rule in `src/shared/` (for example `turnOrder.ts`), writes through the repository and answers. The rule's variants are unit tested there. The route's test proves the wiring: the status, the guard and the stored result.
