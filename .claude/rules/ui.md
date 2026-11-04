---
paths:
  - "app/**"
  - "src/client/**"
  - "index.html"
---

# UI rules

The app exists to be read. Every visual decision serves the story text first.

## Story first

- On a story page the story text is the largest, highest-contrast thing. Status, buttons and the invite link stay quieter than the prose.
- Authors exist for accountability: tracing who wrote something offensive, and crediting a good contribution. They are never part of the reading, so they stay findable and quiet.
  - On wide screens (`md` and up) each paragraph's authors sit in a margin beside it, under a hairline rule, one name per author. Hovering a name, or focusing it by keyboard, highlights that author's turns in the paragraph.
  - On narrow screens there is no room for a margin, so authors are hidden behind a "Show authors" toggle, off by default. Show less where there is less space. With the toggle on, tapping a name highlights that author's turns until the next tap.
  - Laptops and phones may differ. Hover can add to the wide-screen view; the phone view gets its own touch equivalent, such as tap.
- Paragraphs sit bare on the page, separated by space alone, so they read as one continuous text. A turn continues the previous paragraph unless its author ticked "New paragraph".

## Layout

- The story page is a rail beside the story. The rail holds the wordmark, a link back to the writer's stories, whose turn it is, the turn order, the invite link and a quiet "Leave story" button. On a phone the rail stacks above the story, with the invite link and the leave button last, below the story.
- The landing page is a pitch on one side and the form on a tinted panel on the other. A writer who is in stories sees them listed in place of the pitch, with the form retitled "Start a new story". On a phone the three steps are dropped and the form follows the headline.
- Design for a 375px-wide phone first, then widen. `md` is Tamagui's built-in 768px breakpoint.

## Components

The kit is Tamagui. Its components are used as they come, doing what its docs say they can do and nothing more. Only the theme is ours. We are informed by the old design, not bound to it: where a stock component looks or behaves differently, the stock component wins.

- Allowed, because the docs describe it:
  - theme tokens and the Tamagui config
  - a component's documented props and state props
  - a component's parts composed in the documented structure, such as the Dialog "skin" from the docs
- Not allowed:
  - a prop the docs do not list for that component, such as an `aria-label` or `role` override that changes what a component exposes
  - a handler that works around a component's behaviour, such as one that restores focus
  - a wrapper that adds behaviour, a patched package, or a hand-built replacement for a component Tamagui has
- A bug in a stock component is filed as a GitHub issue. It is not fixed in our code. A test that has to avoid the bug links the issue.
- Custom UI code is limited to the story text layout: paragraphs, and the authors in a margin from `md` up.
- Each page has one level-1 heading, the wordmark, and a level-2 heading for its own title where it has one.

## Type

- Two typefaces. Source Serif 4 carries prose: story passages, the composer, suggestions, and page headings including the wordmark. Inter carries everything else. Both are set in the Tamagui config.
- Fonts are loaded with `expo-font` and bundled into the build, so rendering matches on every device and no request leaves the origin.

## Colour

- Colours come from two Tamagui themes in the config: `paper` (light, default) and `ink` (dark, follows the OS setting). Components use the theme's semantic tokens, never a raw colour. The tinted panel and the rules and borders each have their own token.
- A new colour is defined in both themes.
- Muted text is the base text colour at 70% opacity, the faintest value that keeps 4.5:1 on the base, tinted-panel and border surfaces in both themes.
- Every text and background pair reaches WCAG AA (4.5:1), shown by computing the ratio in both themes.

## Touch

- Interactive elements are at least 44px tall.
- That size comes from Tamagui's documented `size` prop and the size tokens in the config, never from a pixel value on one element. A stock component that cannot reach 44px that way is left as it is and filed as an issue.
- Everything a user needs is visible, or reachable by tap and keyboard.
- Every interactive element shows a focus ring. Tamagui draws it; check it in both themes.

## Accessibility contract

Tests find elements by role, accessible name, label and visible text. The role is whatever the stock component exposes: a test never forces a role onto a component. Styling changes freely. These change only on purpose, with the tests updated in the same commit:

- labels and visible strings
- `aria-label`s on sections
- `role="status"` and `role="alert"`, including the single `status` in `TurnBanner`
- the list, item, button structure in `Suggestions`
- the "Show authors" toggle and the author buttons (`aria-pressed`) in `StoryText`
- the "New paragraph" checkbox in `Composer`
- the "Your stories" region on the landing page, whose rows are links named by the opening passage and the turn status
- the "Your stories" link in the story rail
- the "Leave story" button, and the leave dialog named "Leave this story?" with its "Cancel" and "Leave story" buttons
- the "You left this story" screen and its "Rejoin as …" button

Inside Tamagui's `Dialog`, tests find the buttons by visible text, because `Dialog.Close` names itself "Dialog Close".

## Done

A UI change is done when:

- you have looked at every changed page in `paper` and `ink` (set `prefers-color-scheme`), at 375px and at desktop width
- every component use fits the "Components" section
- the checks in `CLAUDE.md` pass, and so does `pnpm e2e`
