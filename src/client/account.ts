import { putMyAccount } from "./api";

// A merge that meets a turn change answers 409 `stale_turn`; the turn has usually settled by now.
export const STALE_TURN_RETRY_DELAY_MS = 1000;

const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

/**
 * Brings this device's stories into the signed-in account, and tells `onDeviceUserAdded` listeners
 * once it worked. Call it whenever a session is known to be there: after sign-in, and on every
 * app load, so a merge that was cut short heals.
 *
 * Callers that overlap share one request. A failure is not shown and not retried until the next
 * call, except a `stale_turn` clash, which is retried once.
 */
export function syncAccount(): Promise<void> {
  inFlight ??= run().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Calls `listener` after each successful add, when the account's stories may have changed. */
export function onDeviceUserAdded(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

async function run(): Promise<void> {
  let result = await putMyAccount();
  if (isStaleTurn(result)) {
    await new Promise((resolve) => setTimeout(resolve, STALE_TURN_RETRY_DELAY_MS));
    result = await putMyAccount();
  }

  if (result.ok) {
    for (const listener of listeners) {
      listener();
    }
  }
}

function isStaleTurn(result: Awaited<ReturnType<typeof putMyAccount>>): boolean {
  return !result.ok && result.failure.type === "rejected" && result.failure.code === "stale_turn";
}
