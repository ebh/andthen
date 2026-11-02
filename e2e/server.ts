/** Shared by the Playwright config and `prepare.ts`. */

export const E2E_PORT = 4173;

/** Where the e2e run keeps its local D1, apart from `.wrangler/state` that `pnpm dev` uses. */
export const E2E_STATE_DIR = ".wrangler/e2e-state";
