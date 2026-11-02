import { defineConfig, devices } from "@playwright/test";

import { E2E_PORT, E2E_STATE_DIR } from "./server.ts";

// The app must be reached as `localhost`: only there is the cookie sent without `Secure`
// (WebKit drops `__Host-` over HTTP), and every browser context gets its own cookie jar.
const baseURL = `http://localhost:${E2E_PORT.toString()}`;
const inCi = process.env["CI"] !== undefined;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: inCi,
  // A retry would hide a flake, so there are none.
  retries: 0,
  workers: inCi ? 2 : "50%",
  reporter: inCi
    ? [["github"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : [["list"]],
  outputDir: "../test-results",
  expect: { timeout: 10_000 },
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `prepare` gives each run a fresh local D1 and a fresh build; the server then serves it.
    command: `node e2e/prepare.ts && pnpm exec vite preview --port ${E2E_PORT.toString()} --strictPort`,
    // Relative to this file: run from the repo root, where `.wrangler` and `dist` live.
    cwd: "..",
    url: `${baseURL}/api/health`,
    // Reusing a running server would reuse its database, so reruns could collide.
    reuseExistingServer: false,
    timeout: 180_000,
    env: { E2E_STATE_DIR },
  },
});
