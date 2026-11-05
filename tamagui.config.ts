import { createV6Config, withTailwindTypeScale } from "@tamagui/config/v6";
import { createFont, createTamagui } from "tamagui";

/** The project's two palettes, as Tamagui themes. */
const light = {
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
  "base-200": "#ebe3d0",
  muted: "rgba(30, 27, 22, 0.7)",
  primary: "#1f5c4d",
  "primary-content": "#f6f1e7",
  error: "#9b2226",
  "error-content": "#fff5f3",
  highlight: "rgba(31, 92, 77, 0.2)",
};

const dark: typeof light = {
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
  "base-200": "#1f2421",
  muted: "rgba(236, 230, 214, 0.7)",
  primary: "#7fc4a8",
  "primary-content": "#0f1a15",
  error: "#f08a8a",
  "error-content": "#2a0f0f",
  highlight: "rgba(127, 196, 168, 0.2)",
};

/**
 * Tamagui wraps every Button in a `level2` sub-theme, so these themes style a plain Button, the
 * secondary look: `muted` text and a `muted` border (the stock `border-color` hairline is under 3:1 against
 * the page), with a `border-color` fill on hover and press. A `variant="outlined"` or `variant="quiet"`
 * Button, which has no fill of its own, still takes the hover fill.
 */
const lightButton: typeof light = {
  ...light,
  "background-hover": light["border-color"],
  "background-press": light["border-color"],
  color: light.muted,
  "color-hover": light.muted,
  "color-press": light.muted,
  "color-focus": light.muted,
  "border-color": light.muted,
  "border-color-hover": light.muted,
  "border-color-press": light.muted,
  "outline-color": light.color,
};

const darkButton: typeof light = {
  ...dark,
  "background-hover": dark["border-color"],
  "background-press": dark["border-color"],
  color: dark.muted,
  "color-hover": dark.muted,
  "color-press": dark.muted,
  "color-focus": dark.muted,
  "border-color": dark.muted,
  "border-color-hover": dark.muted,
  "border-color-press": dark.muted,
  "outline-color": dark.color,
};

/**
 * A Button opts in to a solid fill with `theme="primary"` or `theme="destructive"`, which the Button
 * wraps above its own `level2`, so the fill resolves as `<palette>_<theme>_level2`. The fill uses the
 * palette's `primary` or `error` colour with its content colour as text.
 */
const lightPrimaryButton: typeof light = {
  ...light,
  background: light.primary,
  "background-hover": "#184a3e",
  "background-press": "#143d33",
  "background-focus": light.primary,
  color: light["primary-content"],
  "color-hover": light["primary-content"],
  "color-press": light["primary-content"],
  "color-focus": light["primary-content"],
  "outline-color": light.color,
};

const darkPrimaryButton: typeof light = {
  ...dark,
  background: dark.primary,
  "background-hover": "#93d0b8",
  "background-press": "#6aaf93",
  "background-focus": dark.primary,
  color: dark["primary-content"],
  "color-hover": dark["primary-content"],
  "color-press": dark["primary-content"],
  "color-focus": dark["primary-content"],
  "outline-color": dark.color,
};

const lightDestructiveButton: typeof light = {
  ...lightPrimaryButton,
  background: light.error,
  "background-hover": "#861d21",
  "background-press": "#70181b",
  "background-focus": light.error,
  color: light["error-content"],
  "color-hover": light["error-content"],
  "color-press": light["error-content"],
  "color-focus": light["error-content"],
};

const darkDestructiveButton: typeof light = {
  ...darkPrimaryButton,
  background: dark.error,
  "background-hover": "#f39d9d",
  "background-press": "#e07676",
  "background-focus": dark.error,
  color: dark["error-content"],
  "color-hover": dark["error-content"],
  "color-press": dark["error-content"],
  "color-focus": dark["error-content"],
};

/**
 * The dim layer behind a dialog. The stock `Overlay` paints the theme's `background`, so a dialog
 * renders it with `theme="scrim"`, which resolves as `<palette>_scrim`.
 */
const lightScrim: typeof light = { ...light, background: "rgba(30, 27, 22, 0.5)" };
const darkScrim: typeof light = { ...dark, background: "rgba(0, 0, 0, 0.6)" };

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
    light,
    dark,
    light_level2: lightButton,
    dark_level2: darkButton,
    light_primary: light,
    dark_primary: dark,
    light_primary_level2: lightPrimaryButton,
    dark_primary_level2: darkPrimaryButton,
    light_destructive: light,
    dark_destructive: dark,
    light_destructive_level2: lightDestructiveButton,
    dark_destructive_level2: darkDestructiveButton,
    light_scrim: lightScrim,
    dark_scrim: darkScrim,
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
