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

- Themes are generated from palettes with `createThemes` in `tamagui.config.ts`. A theme is never hand-written for one component: a component that looks wrong gets a palette step or a tree change, so every stock component benefits.
- The roots are `light` (default) and `dark` (follows the OS setting). `createThemes` accepts no other root names.
- A palette is eleven colours, steps 50 (palest) to 950 (deepest), named `<palette>-<step>`. The stock theme scales choose steps by number, so the step a role lands on is fixed. The config's comment above `palettes` says which steps carry which job.
- There are two surface palettes, `surface` for `light` and `surface-dark` for `dark`, because the page and the text sit on the same step numbers in both schemes but are different colours. `brand` and `red` are one ramp each, shared by both schemes.
- Only the palettes, `white` and `black` become colour tokens. The full stock set adds hundreds of unused CSS variables.
- The tree has `light` and `dark` with the stock `levels()` (`level2` is the raised surface and the theme every `Button` wraps itself in), then `brand` and `destructive` (solid fills, each with `levels()`) and `scrim` (the dialog backdrop). Add a child only when a stock component or a page needs it.
- The keys are Tamagui's own (`background`, `color`, `border-color`, `color-1` to `color-11`, with hover, press and focus variants), plus four of ours where Tamagui has no role: `muted`, `highlight`, `primary` and `error`. Each is defined for both schemes in `ownKeys`. Use a Tamagui key where one fits.
- A new colour is a palette step or an own key defined for both schemes.
- Muted text is the base text colour at 70% opacity, the faintest value that keeps 4.5:1 on the page, the `level2` surface and `highlight`, in both schemes.
- Every text and background pair reaches WCAG AA (4.5:1), shown by computing the ratio in both themes, including button text on `brand` and `destructive` fills at rest, hover and press. `border-color` and the unchecked `Switch` track (`color-4`) reach 3:1 against the page. When a pair fails, change the palette step, not the rule.
