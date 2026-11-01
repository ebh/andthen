import { defineConfig } from "vitest/config";

// Stryker mutates only src/shared and src/worker, so the jsdom component tests can't kill a
// mutant. Leaving them (and their setup file) out keeps the mutation run inside CI's time limit.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
