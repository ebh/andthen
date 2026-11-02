---
paths:
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

- The story page is a rail beside the story. The rail holds the wordmark, whose turn it is, the turn order and the invite link. On a phone the rail stacks above the story.
- The landing page is a pitch on one side and the form on a tinted panel on the other. On a phone the three steps are dropped and the form follows the headline.
- Design for a 375px-wide phone first, then widen.

## Type

- Two typefaces. `font-story` (Source Serif 4) carries prose: story passages, the composer, suggestions, and page headings including the wordmark. Inter, the default sans, carries everything else.
- Fonts are self-hosted through `@fontsource-variable/*` and imported in `styles.css`, so rendering matches on every device and no request leaves the origin.

## Colour

- Colours come from the two daisyUI themes in `styles.css`: `paper` (light, default) and `ink` (dark, follows the OS setting). Components use semantic classes (`bg-base-200`, `text-primary`, `text-error`). `base-200` is the tinted panel; `base-300` is for rules and borders.
- A new colour is defined in both themes in `styles.css`.
- Muted text is `text-base-content/70`, the faintest value that keeps 4.5:1 on `base-100`, `base-200` and `base-300` in both themes.
- Every text and background pair reaches WCAG AA (4.5:1), shown by computing the ratio in both themes.

## Touch

- Interactive elements are at least 44px tall (`min-h-11` or `h-11`).
- Everything a user needs is visible, or reachable by tap and keyboard.

## Components

- Build from daisyUI components. Reach for a new UI library only after raising it with the owner.
- Each page has one `h1`, the `Wordmark`, and an `h2` for its own title where it has one.
- Every interactive element shows a focus ring. daisyUI draws it on buttons and fields; `styles.css` draws it on plain links.

## Accessibility contract

Tests find elements by accessible name, label, role and visible text. Classes change freely. These change only on purpose, with the tests updated in the same commit:

- labels and visible strings
- `aria-label`s on sections
- `role="status"` and `role="alert"`, including the single `status` in `TurnBanner`
- the list, item, button structure in `Suggestions`
- the "Show authors" checkbox and the author buttons (`aria-pressed`) in `StoryText`
- the "New paragraph" checkbox in `Composer`

## Done

A UI change is done when:

- you have looked at every changed page in `paper` and `ink` (set `prefers-color-scheme`), at 375px and at desktop width
- the checks in `CLAUDE.md` pass, and so does `pnpm e2e`
