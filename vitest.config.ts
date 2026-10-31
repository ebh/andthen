import { defineConfig } from "vitest/config";

// Component tests (*.test.tsx) opt into jsdom with a `@vitest-environment jsdom` docblock; the
// rest run in plain Node.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts"],
    setupFiles: ["src/client/testSetup.ts"],
  },
});
