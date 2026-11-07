import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIGN_IN_STATE_WAIT_MS, type SessionSource } from "./sessionToken";

function source(overrides: Partial<SessionSource> = {}): SessionSource {
  return {
    isLoaded: true,
    getToken: vi.fn<SessionSource["getToken"]>(() => Promise.resolve("token-1")),
    ...overrides,
  };
}

// The module keeps the source and the give-up for the page's life, so each test loads it afresh.
async function freshSessionToken() {
  vi.resetModules();

  return import("./sessionToken");
}

let sessionToken: Awaited<ReturnType<typeof freshSessionToken>>;

beforeEach(async () => {
  vi.useFakeTimers();
  sessionToken = await freshSessionToken();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSessionToken", () => {
  it("returns the token of a loaded Clerk", async () => {
    sessionToken.setSessionSource(source());

    expect(await sessionToken.getSessionToken()).toBe("token-1");
  });

  it("asks Clerk on every call and never keeps the answer", async () => {
    const getToken = vi.fn<SessionSource["getToken"]>();
    getToken.mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    sessionToken.setSessionSource(source({ getToken }));

    expect(await sessionToken.getSessionToken()).toBe("first");
    expect(await sessionToken.getSessionToken()).toBe("second");
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("passes no options for a normal call and skipCache for a fresh one", async () => {
    const getToken = vi.fn<SessionSource["getToken"]>(() => Promise.resolve("t"));
    sessionToken.setSessionSource(source({ getToken }));

    await sessionToken.getSessionToken();
    await sessionToken.getSessionToken({ fresh: true });

    expect(getToken).toHaveBeenNthCalledWith(1, undefined);
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
  });

  it("is anonymous when Clerk has no token", async () => {
    sessionToken.setSessionSource(source({ getToken: () => Promise.resolve(null) }));

    expect(await sessionToken.getSessionToken()).toBeNull();
  });

  it("is anonymous when Clerk fails to give a token", async () => {
    sessionToken.setSessionSource(source({ getToken: () => Promise.reject(new Error("offline")) }));

    expect(await sessionToken.getSessionToken()).toBeNull();
  });

  it("waits for a source that is not registered yet", async () => {
    const pending = sessionToken.getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS - 1);
    sessionToken.setSessionSource(source());

    expect(await pending).toBe("token-1");
  });

  it("waits for a source that is registered but not loaded", async () => {
    sessionToken.setSessionSource(source({ isLoaded: false }));
    const pending = sessionToken.getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS - 1);
    sessionToken.setSessionSource(source());

    expect(await pending).toBe("token-1");
  });

  it("carries on anonymously once the wait runs out", async () => {
    const getToken = vi.fn<SessionSource["getToken"]>(() => Promise.resolve("t"));
    sessionToken.setSessionSource(source({ isLoaded: false, getToken }));
    const pending = sessionToken.getSessionToken();

    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS - 1);
    const settled = vi.fn<() => void>();
    void pending.finally(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });

  it("does not wait again after giving up", async () => {
    const first = sessionToken.getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS);
    await first;

    expect(await sessionToken.getSessionToken()).toBeNull();
  });

  it("uses Clerk if it finishes loading after the wait ran out", async () => {
    const first = sessionToken.getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS);
    await first;
    sessionToken.setSessionSource(source());

    expect(await sessionToken.getSessionToken()).toBe("token-1");
  });

  it("answers every call that was waiting when Clerk loaded", async () => {
    const calls = [sessionToken.getSessionToken(), sessionToken.getSessionToken()];
    sessionToken.setSessionSource(source());

    expect(await Promise.all(calls)).toEqual(["token-1", "token-1"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
