import { defineConfig } from "vitest/config";

// Component tests (*.test.tsx) opt into jsdom with a `@vitest-environment jsdom` docblock; the
// rest run in plain Node.
export default defineConfig({
  resolve: {
    // The Expo UI under src/ui renders on react-native-web in jsdom, as the web export does.
    alias: { "react-native": "react-native-web" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["src/client/testSetup.ts", "src/ui/testSetup.ts"],
    server: {
      // Inlined so the alias above also reaches the `react-native` imports inside these packages.
      deps: { inline: [/tamagui/, /react-native-web/] },
    },
  },
});
