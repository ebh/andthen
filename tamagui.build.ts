import type { TamaguiBuildOptions } from "tamagui";

const isDev = process.env.NODE_ENV === "development";

export default {
  config: "./tamagui.config.ts",
  components: ["tamagui"],
  outputCSS: "./tamagui.generated.css",
  // The Metro plugin lowers components to class names but never writes their CSS
  // (only `tamagui build` does), so it is off wherever `tamagui build` has not run.
  disable: isDev,
} satisfies TamaguiBuildOptions;
