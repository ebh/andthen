---
paths:
  - "src/**/*.test.tsx"
---

# Component test rules

A component test renders a page or component in jsdom and checks what a person sees and does. Each render costs about 270 ms, because Tamagui and react-native-web are transformed and mounted. `testing.md` holds the rules for every test.

- **Test the component a route renders, and cover the components it renders through it.** A component that has a test file because it is a component, not because its states need one, is a smell.
- **A child component keeps its own test file only when its states come from something its parent's tests do not control**: screen width, hover support, a browser API such as push or install, Clerk's loading state, or StrictMode. Even then its tests follow "few and long".
- **A child tested through its parent is checked by the per-file coverage floor (`pnpm test:coverage`) and by the `ui` Stryker shard.** Before deleting a child's test file, check that both still hold for that child: its coverage stays above the floor and its mutation score does not drop.
- **Keep one assertion that user-written and AI-written text renders as plain text**, never as HTML, wherever such text is shown, such as passages and suggestions.
- **A test that needs the same state as another continues the same session** rather than starting a new render. A rerender at a new turn version and a second submit after a failure are examples.
- **Few and long.** One render, then several act and assert rounds that follow what a person does: type, press, read the result, press again. A test reads as a short session on one screen.
- **Cover the happy path and the states the screen must show**: working, failed, unavailable. Walk through them in the same test where one flow reaches them.
- **Assert a rule's result once.** The rule itself has unit tests (`testability.md`). A component test checks that the screen shows the result of one case, and leaves the variants to the unit test. Grapheme counts and who gets the turn next are examples.
- **Find elements the way `ui.md` says**: by role, accessible name, label and visible text.
- **Logic found in a component test belongs in a unit test.** When a test pins a branch, extract the branch.
- Shared render helpers are in `src/ui/testRender.tsx`, `testScreen.ts` and `routerStub.tsx`. Add a helper there when a second test file needs it.
