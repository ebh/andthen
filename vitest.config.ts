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
    coverage: {
      provider: "v8",
      include: ["src/ui/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "src/ui/routerStub.tsx",
        "src/ui/clerkStub.ts",
        "src/ui/testRender.tsx",
        "src/ui/testScreen.ts",
        "src/ui/testSetup.ts",
      ],
      reporter: ["text"],
      thresholds: { perFile: true, lines: 95, branches: 75 },
    },
    server: {
      // Inlined so the alias above also reaches the `react-native` imports inside these packages.
      deps: { inline: [/tamagui/, /react-native-web/] },
    },
  },
});
