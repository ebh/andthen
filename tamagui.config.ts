import { createV6Config, withTailwindTypeScale } from "@tamagui/config/v6";
import {
  createThemes,
  getTheme as getStockTheme,
  levels,
  paletteTokens,
  tokens as stockTokens,
  type GetThemeContext,
  type Ramp,
  type SemanticThemeKey,
  type ThemeDefinitionContext,
  type ShadowName,
} from "@tamagui/config/v6-builder";
import { createFont, createTamagui } from "tamagui";

/*
 * Palettes: eleven steps from 50 (palest) to 950 (deepest). The stock theme scales pick steps by
 * number, so the steps that carry a job are pinned by the contrast they must reach:
 * - surface 50 and dark 950 are the page; surface 950 and dark 50 are the text. The two schemes
 *   need different warm and cool neutrals, so each has its own ramp.
 * - surface 100 and dark 900 are the raised surface. surface 200 and dark 800 are the border and the
 *   Button press and hover fills: at least 3:1 against the page, and 4.5:1 with the text on them.
 * - brand 600 and red 600 are the solid fill in the light scheme; 500 is the hover fill there and
 *   the resting fill in the dark scheme, so 500 and 400 stay deep enough for step 50 text.
 * - brand 300 and red 300 are the text colours in the dark scheme.
 */
const palettes = {
  surface: [
    "#f6f1e7",
    "#ebe3d0",
    "#96896b",
    "#928565",
    "#877b5e",
    "#695f48",
    "#544c38",
    "#453e2c",
    "#373122",
    "#2b251a",
    "#1e1b16",
  ],
  "surface-dark": [
    "#ece6d6",
    "#d4cebf",
    "#b6b6a5",
    "#9ca499",
    "#8d9a8f",
    "#808e84",
    "#66726a",
    "#5e6a62",
    "#5e6961",
    "#1f2421",
    "#171a18",
  ],
  brand: [
    "#eaf6f3",
    "#cfebe4",
    "#a6d9cc",
    "#7fc4a8",
    "#297a66",
    "#267360",
    "#1f5c4d",
    "#194a3e",
    "#143b32",
    "#0f2e27",
    "#0b221d",
  ],
  red: [
    "#fdf1f1",
    "#f9dfdf",
    "#f4bfc0",
    "#f08a8a",
    "#c63b40",
    "#bb363b",
    "#9b2226",
    "#752225",
    "#5b1a1c",
    "#491517",
    "#371011",
  ],
} as const;

// Only these colours become tokens: the full stock set would add hundreds of unused CSS variables.
const colorTokens = {
  white: stockTokens.color.white,
  black: stockTokens.color.black,
  ...paletteTokens(palettes),
};

type Tokens = { color: Record<string, string> };

type Recipe = {
  scheme: "light" | "dark";
  palette: string;
  treatment?: "normal" | "bold" | "tint";
  level?: 1 | 2 | 3 | 4;
  active?: boolean;
};

type Theme = Record<
  keyof Ramp | SemanticThemeKey | ShadowName | "muted" | "highlight" | "primary" | "error",
  string
>;

/** The keys Tamagui has no role for, per scheme. */
const ownKeys = {
  light: {
    muted: "rgba(30, 27, 22, 0.7)",
    highlight: "rgba(31, 92, 77, 0.2)",
    primary: "brand-600",
    error: "red-600",
  },
  dark: {
    muted: "rgba(236, 230, 214, 0.7)",
    highlight: "rgba(127, 196, 168, 0.2)",
    primary: "brand-300",
    error: "red-300",
  },
} as const;

// Standalone, with explicit generics on `createThemes` below: inferring it from the tree fails.
function getTheme(context: GetThemeContext<Tokens, Recipe>): Theme {
  return { ...getStockTheme(context), ...ownKeys[context.recipe.scheme] };
}

const tree = {
  light: { scheme: "light", palette: "surface" },
  dark: { scheme: "dark", palette: "surface-dark" },
  children: {
    // Every Button wraps itself in `level2`, and a panel takes it as its raised surface.
    ...levels(),
    // A solid fill, which the checked Switch and Checkbox and `<Button theme="brand">` take.
    brand: { palette: "brand", treatment: "bold", children: levels() },
    // `<Button theme="destructive">`.
    destructive: { palette: "red", treatment: "bold", children: levels() },
    // The dim layer behind a dialog: the stock `Overlay` paints the theme's `background`.
    scrim: ({ parent }: ThemeDefinitionContext) => ({
      values: {
        background: parent.scheme === "light" ? "rgba(30, 27, 22, 0.5)" : "rgba(0, 0, 0, 0.6)",
      },
    }),
  },
} as const;

const themes = createThemes<Tokens, typeof tree, Theme>({ color: colorTokens }, tree, { getTheme });

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

const base = createV6Config({ themes, colorTokens });

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
