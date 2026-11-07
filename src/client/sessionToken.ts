export interface SessionSource {
  /** Whether Clerk has finished loading and so knows if anyone is signed in. */
  isLoaded: boolean;
  /** Clerk's `getToken`: the signed-in session's token, or null when signed out. */
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
}

// Long enough for a slow clerk-js download, short enough that a blocked or down Clerk delays an
// anonymous reader's first request by a few seconds and no more.
export const CLERK_WAIT_MS = 3000;

let source: SessionSource | null = null;
let gaveUpWaiting = false;
const waiting = new Set<() => void>();

/** Called by the component inside `ClerkProvider` each time Clerk's auth state changes. */
export function setSessionSource(next: SessionSource | null): void {
  source = next;
  if (source?.isLoaded === true) {
    for (const wake of waiting) {
      wake();
    }
  }
}

/** Forgets the source and the give-up, so each test starts as a fresh page load. */
export function resetSessionSource(): void {
  source = null;
  gaveUpWaiting = false;
  waiting.clear();
}

/**
 * The session token to send, or null to send the request anonymously. Never cached: Clerk's
 * tokens last a minute, and Clerk's own `getToken` renews them.
 *
 * Waits for Clerk to load, so a signed-in device never goes out as anonymous. The wait is
 * bounded, and once it has run out later calls don't wait again, so a blocked Clerk costs one
 * delay per page load. A token that can't be fetched counts as no token: anonymous use must work
 * without Clerk.
 *
 * `fresh` skips Clerk's cache, for a retry after the Worker rejected the token.
 */
export async function getSessionToken(options: { fresh?: boolean } = {}): Promise<string | null> {
  if (!(await clerkIsLoaded()) || source === null) {
    return null;
  }

  try {
    return await source.getToken(options.fresh === true ? { skipCache: true } : undefined);
  } catch {
    return null;
  }
}

function clerkIsLoaded(): Promise<boolean> {
  if (source?.isLoaded === true) {
    return Promise.resolve(true);
  }
  if (gaveUpWaiting) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const finish = (loaded: boolean): void => {
      clearTimeout(timer);
      waiting.delete(wake);
      resolve(loaded);
    };
    const wake = (): void => {
      finish(true);
    };
    const timer = setTimeout(() => {
      gaveUpWaiting = true;
      finish(false);
    }, CLERK_WAIT_MS);
    waiting.add(wake);
  });
}
