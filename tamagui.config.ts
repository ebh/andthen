import { createV6Config, withTailwindTypeScale } from "@tamagui/config/v6";
import { createFont, createTamagui } from "tamagui";

/** paper (light) and ink (dark), the project's two palettes, as Tamagui themes. */
const paper = {
  background: "#f6f1e7",
  "background-hover": "#f6f1e7",
  "background-press": "#ebe3d0",
  "background-focus": "#f6f1e7",
  color: "#1e1b16",
  "color-hover": "#1e1b16",
  "color-press": "#1e1b16",
  "color-focus": "#1e1b16",
  "border-color": "#d9cfba",
  "border-color-hover": "#d9cfba",
  "border-color-press": "#d9cfba",
  "border-color-focus": "#1f5c4d",
  "placeholder-color": "rgba(30, 27, 22, 0.7)",
  "outline-color": "#1f5c4d",
  "shadow-color": "rgba(0, 0, 0, 0.1)",
  "base-100": "#f6f1e7",
  "base-200": "#ebe3d0",
  "base-300": "#d9cfba",
  "base-content": "#1e1b16",
  muted: "rgba(30, 27, 22, 0.7)",
  primary: "#1f5c4d",
  "primary-content": "#f6f1e7",
  secondary: "#ddd3bd",
  "secondary-content": "#1e1b16",
  error: "#9b2226",
  "error-content": "#fff5f3",
  highlight: "rgba(31, 92, 77, 0.2)",
  "color-4": "#8a8374",
  "color-5": "#7a7365",
};

const ink: typeof paper = {
  background: "#171a18",
  "background-hover": "#171a18",
  "background-press": "#1f2421",
  "background-focus": "#171a18",
  color: "#ece6d6",
  "color-hover": "#ece6d6",
  "color-press": "#ece6d6",
  "color-focus": "#ece6d6",
  "border-color": "#2c332f",
  "border-color-hover": "#2c332f",
  "border-color-press": "#2c332f",
  "border-color-focus": "#7fc4a8",
  "placeholder-color": "rgba(236, 230, 214, 0.7)",
  "outline-color": "#7fc4a8",
  "shadow-color": "rgba(0, 0, 0, 0.4)",
  "base-100": "#171a18",
  "base-200": "#1f2421",
  "base-300": "#2c332f",
  "base-content": "#ece6d6",
  muted: "rgba(236, 230, 214, 0.7)",
  primary: "#7fc4a8",
  "primary-content": "#0f1a15",
  secondary: "#2c332f",
  "secondary-content": "#ece6d6",
  error: "#f08a8a",
  "error-content": "#2a0f0f",
  highlight: "rgba(127, 196, 168, 0.2)",
  "color-4": "#6f7873",
  "color-5": "#7f8883",
};

/**
 * Tamagui wraps every Button in a `level2` sub-theme, so these themes style a plain Button, the
 * secondary look: `muted` text and a `muted` border (the stock `base-300` hairline is under 3:1 against
 * the page), with a `base-300` fill on hover and press. A `variant="outlined"` or `variant="quiet"`
 * Button, which has no fill of its own, still takes the hover fill.
 */
const paperButton: typeof paper = {
  ...paper,
  "background-hover": paper["base-300"],
  "background-press": paper["base-300"],
  color: paper.muted,
  "color-hover": paper.muted,
  "color-press": paper.muted,
  "color-focus": paper.muted,
  "border-color": paper.muted,
  "border-color-hover": paper.muted,
  "border-color-press": paper.muted,
  "outline-color": paper["base-content"],
};

const inkButton: typeof paper = {
  ...ink,
  "background-hover": ink["base-300"],
  "background-press": ink["base-300"],
  color: ink.muted,
  "color-hover": ink.muted,
  "color-press": ink.muted,
  "color-focus": ink.muted,
  "border-color": ink.muted,
  "border-color-hover": ink.muted,
  "border-color-press": ink.muted,
  "outline-color": ink["base-content"],
};

/**
 * A Button opts in to a solid fill with `theme="primary"` or `theme="destructive"`, which the Button
 * wraps above its own `level2`, so the fill resolves as `<palette>_<theme>_level2`. The fill uses the
 * palette's `primary` or `error` colour with its content colour as text.
 */
const paperPrimaryButton: typeof paper = {
  ...paper,
  background: paper.primary,
  "background-hover": "#184a3e",
  "background-press": "#143d33",
  "background-focus": paper.primary,
  color: paper["primary-content"],
  "color-hover": paper["primary-content"],
  "color-press": paper["primary-content"],
  "color-focus": paper["primary-content"],
  "outline-color": paper["base-content"],
};

const inkPrimaryButton: typeof paper = {
  ...ink,
  background: ink.primary,
  "background-hover": "#93d0b8",
  "background-press": "#6aaf93",
  "background-focus": ink.primary,
  color: ink["primary-content"],
  "color-hover": ink["primary-content"],
  "color-press": ink["primary-content"],
  "color-focus": ink["primary-content"],
  "outline-color": ink["base-content"],
};

const paperDestructiveButton: typeof paper = {
  ...paperPrimaryButton,
  background: paper.error,
  "background-hover": "#861d21",
  "background-press": "#70181b",
  "background-focus": paper.error,
  color: paper["error-content"],
  "color-hover": paper["error-content"],
  "color-press": paper["error-content"],
  "color-focus": paper["error-content"],
};

const inkDestructiveButton: typeof paper = {
  ...inkPrimaryButton,
  background: ink.error,
  "background-hover": "#f39d9d",
  "background-press": "#e07676",
  "background-focus": ink.error,
  color: ink["error-content"],
  "color-hover": ink["error-content"],
  "color-press": ink["error-content"],
  "color-focus": ink["error-content"],
};

/**
 * A checked `Switch` moves itself onto a `brand` sub-theme: its track fills with `background` and
 * its thumb with `color`. An unchecked track fills with `color-4` (`color-5` on hover), which the
 * palettes above define as a solid that keeps 3:1 against the page.
 */
const paperBrand: typeof paper = {
  ...paper,
  background: paper.primary,
  color: paper["primary-content"],
  "outline-color": paper["base-content"],
};

const inkBrand: typeof paper = {
  ...ink,
  background: ink.primary,
  color: ink["primary-content"],
  "outline-color": ink["base-content"],
};

/**
 * The dim layer behind a dialog. The stock `Overlay` paints the theme's `background`, so a dialog
 * renders it with `theme="scrim"`, which resolves as `<palette>_scrim`.
 */
const paperScrim: typeof paper = { ...paper, background: "rgba(30, 27, 22, 0.5)" };
const inkScrim: typeof paper = { ...ink, background: "rgba(0, 0, 0, 0.6)" };

const sizes = { 1: 12, 2: 14, 3: 16, 4: 20, 5: 25, 6: 30 };
const lineHeights = { 1: 18, 2: 20, 3: 24, 4: 32, 5: 40, 6: 44 };

// `face` maps weights to the names expo-font registers; web uses `family` plus the same @font-face names.
const story = createFont(
  withTailwindTypeScale({
    family: "SourceSerif4_400Regular",
    size: sizes,
    lineHeight: lineHeights,
    weight: { 4: "400", 6: "600" },
    letterSpacing: { 4: 0 },
    face: {
      400: { normal: "SourceSerif4_400Regular" },
      600: { normal: "SourceSerif4_600SemiBold" },
    },
  }),
);

const body = createFont(
  withTailwindTypeScale({
    family: "Inter_400Regular",
    size: sizes,
    lineHeight: lineHeights,
    weight: { 4: "400", 6: "600" },
    letterSpacing: { 4: 0 },
    face: {
      400: { normal: "Inter_400Regular" },
      600: { normal: "Inter_600SemiBold" },
    },
  }),
);

const base = createV6Config({
  themes: {
    paper,
    ink,
    paper_level2: paperButton,
    ink_level2: inkButton,
    paper_primary: paper,
    ink_primary: ink,
    paper_primary_level2: paperPrimaryButton,
    ink_primary_level2: inkPrimaryButton,
    paper_destructive: paper,
    ink_destructive: ink,
    paper_destructive_level2: paperDestructiveButton,
    ink_destructive_level2: inkDestructiveButton,
    paper_brand: paperBrand,
    ink_brand: inkBrand,
    paper_scrim: paperScrim,
    ink_scrim: inkScrim,
  },
});

/**
 * Content widths, as `size` tokens so that `maxW` takes them. The stock scale stops at 384px,
 * and the named widths it carries (`2xl`) are not typed for `maxW`.
 */
const contentWidths = {
  /** The column of a simple page. */
  simplePage: 672,
  /** A narrow column: a form, or a short line of intro text. */
  narrow: 448,
  /** One paragraph of story text: about 55 characters a line at the passage font size. */
  passage: 620,
  /** The story column: the passages, their authors' margin and the composer. */
  story: 796,
};

export const tamaguiConfig = createTamagui({
  ...base,
  tokens: {
    ...base.tokens,
    size: { ...base.tokens.size, ...contentWidths },
    maxWidth: { ...base.tokens.maxWidth, ...contentWidths },
  },
  fonts: { body, story },
  settings: { ...base.settings, defaultFont: "body" },
});

export default tamaguiConfig;

export type Conf = typeof tamaguiConfig;

declare module "tamagui" {
  // Tamagui's documented module augmentation: only an interface merges into its config type.
  // oxlint-disable-next-line typescript/no-empty-object-type
  interface TamaguiCustomConfig extends Conf {}
}
