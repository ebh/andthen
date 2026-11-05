---
paths:
  - "tamagui.config.ts"
  - "tamagui.build.ts"
---

# Design system rules

## Type

- Two typefaces. Source Serif 4 carries prose: story passages, the composer, suggestions, and page headings including the wordmark. Inter carries everything else. Both are set in the Tamagui config.
- Fonts are loaded with `expo-font` and bundled into the build, so rendering matches on every device and no request leaves the origin.

## Colour

- Colours come from two Tamagui themes in the config: `light` (default) and `dark` (follows the OS setting). Components use the theme's semantic tokens, never a raw colour. The tinted panel and the rules and borders each have their own token.
- A new colour is defined in both themes.
- Muted text is the base text colour at 70% opacity, the faintest value that keeps 4.5:1 on the base, tinted-panel and border surfaces in both themes.
- Every text and background pair reaches WCAG AA (4.5:1), shown by computing the ratio in both themes.
