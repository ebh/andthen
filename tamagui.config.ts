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
};

/**
 * Tamagui wraps every Button in a `level2` sub-theme. These make the stock Button a solid
 * `primary` fill: the plain `background` token matches the page and is nearly invisible on the `base-200` panel.
 */
const paperButton: typeof paper = {
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

const inkButton: typeof paper = {
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
  themes: { paper, ink, paper_level2: paperButton, ink_level2: inkButton },
});

export const tamaguiConfig = createTamagui({
  ...base,
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
