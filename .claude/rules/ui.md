---
paths:
  - "src/client/**"
  - "index.html"
---

# UI rules

The app exists to be read. Every visual decision serves the story text first.

## Story first

- On a story page the story text is the largest, highest-contrast thing. Status, buttons and the invite link stay quieter than the prose.
- Each author sits on their own small, muted line under their passage (`text-sm text-base-content/70`). Phones have no hover, so the name is always on screen.
- Passages sit bare on the page, separated by space alone, so they read as one continuous text.

## Type

- Two typefaces. `font-story` (Literata, serif) carries prose: story passages, the composer, suggestions, and page headings including the wordmark. The default sans-serif carries everything else.
- Fonts are self-hosted through `@fontsource-variable/*` and imported in `styles.css`, so rendering matches on every device and no request leaves the origin.

## Colour

- Colours come from the two daisyUI themes in `styles.css`: `paper` (light, default) and `ink` (dark, follows the OS setting). Components use semantic classes (`bg-base-200`, `text-primary`, `text-error`).
- A new colour is defined in both themes in `styles.css`.
- Muted text is `text-base-content/70`, the faintest value that keeps 4.5:1 on `base-100` and `base-200` in both themes.
- Every text and background pair reaches WCAG AA (4.5:1), shown by computing the ratio in both themes.

## Layout and touch

- Design for a 375px-wide phone first, then widen. The page is one centred column.
- Interactive elements are at least 44px tall (`min-h-11` or `h-11`).
- Everything a user needs is visible, or reachable by tap and keyboard.

## Components

- Build from daisyUI components. Reach for a new UI library only after raising it with the owner.
- Each page has one `h1` (the wordmark in `App.tsx`), and an `h2` for its own title where it has one.
- Every interactive element shows a focus ring. daisyUI draws it on buttons and fields; `styles.css` draws it on plain links.

## Accessibility contract

Tests find elements by accessible name, label, role and visible text. Classes change freely. These change only on purpose, with the tests updated in the same commit:

- labels and visible strings
- `aria-label`s on sections
- `role="status"` and `role="alert"`, including the single `status` in `TurnBanner`
- the list, item, button structure in `Suggestions`

## Done

A UI change is done when:

- you have looked at every changed page in `paper` and `ink` (set `prefers-color-scheme`), at 375px and at desktop width
- the checks in `CLAUDE.md` pass, and so does `pnpm e2e`
