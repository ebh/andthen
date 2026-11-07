import { vi } from "vitest";

export interface FakeClerk {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  /** The primary email address of the signed-in user. */
  email: string | null;
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
  signOut: () => Promise<void>;
}

/** What a component test sets to decide what the mocked `@clerk/expo` hooks report. */
export const clerk: FakeClerk = {
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  email: null,
  getToken: vi.fn<FakeClerk["getToken"]>(() => Promise.resolve(null)),
  signOut: vi.fn<FakeClerk["signOut"]>(() => Promise.resolve()),
};

/** Puts `clerk` back to a loaded page with nobody signed in. */
export function resetClerk(): void {
  clerk.isLoaded = true;
  clerk.isSignedIn = false;
  clerk.userId = null;
  clerk.email = null;
  vi.mocked(clerk.getToken).mockReset().mockResolvedValue(null);
  vi.mocked(clerk.signOut).mockReset().mockResolvedValue(undefined);
}

/**
 * Stands in for `@clerk/expo` in component tests, which have no Clerk instance:
 * `vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule)`.
 */
export const clerkModule = {
  useAuth: () => ({
    isLoaded: clerk.isLoaded,
    isSignedIn: clerk.isSignedIn,
    userId: clerk.userId,
    getToken: clerk.getToken,
    signOut: clerk.signOut,
  }),
  useUser: () => ({
    isLoaded: clerk.isLoaded,
    user: clerk.email === null ? null : { primaryEmailAddress: { emailAddress: clerk.email } },
  }),
};
