import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

import { E2E_STATE_DIR } from "./server.ts";

// Run by the Playwright web server before `vite preview`. A new database per run means a rerun
// can never meet the stories of an earlier one.
rmSync(E2E_STATE_DIR, { recursive: true, force: true });

// The build uses the top-level config: local D1 and the fake AI provider. Remote bindings stay off.
const steps = [
  ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", E2E_STATE_DIR],
  ["build"],
];
for (const args of steps) {
  execFileSync("pnpm", args, { stdio: "inherit" });
}
