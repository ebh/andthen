import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIGN_IN_STATE_WAIT_MS,
  getSessionToken,
  resetSessionSource,
  setSessionSource,
  type SessionSource,
} from "./sessionToken";

function source(overrides: Partial<SessionSource> = {}): SessionSource {
  return {
    isLoaded: true,
    getToken: vi.fn<SessionSource["getToken"]>(() => Promise.resolve("token-1")),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionSource();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSessionToken", () => {
  it("returns the token of a loaded Clerk", async () => {
    setSessionSource(source());

    expect(await getSessionToken()).toBe("token-1");
  });

  it("asks Clerk on every call and never keeps the answer", async () => {
    const getToken = vi.fn<SessionSource["getToken"]>();
    getToken.mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    setSessionSource(source({ getToken }));

    expect(await getSessionToken()).toBe("first");
    expect(await getSessionToken()).toBe("second");
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("passes no options for a normal call and skipCache for a fresh one", async () => {
    const getToken = vi.fn<SessionSource["getToken"]>(() => Promise.resolve("t"));
    setSessionSource(source({ getToken }));

    await getSessionToken();
    await getSessionToken({ fresh: true });

    expect(getToken).toHaveBeenNthCalledWith(1, undefined);
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
  });

  it("is anonymous when Clerk has no token", async () => {
    setSessionSource(source({ getToken: () => Promise.resolve(null) }));

    expect(await getSessionToken()).toBeNull();
  });

  it("is anonymous when Clerk fails to give a token", async () => {
    setSessionSource(source({ getToken: () => Promise.reject(new Error("offline")) }));

    expect(await getSessionToken()).toBeNull();
  });

  it("waits for a source that is not registered yet", async () => {
    const pending = getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS - 1);
    setSessionSource(source());

    expect(await pending).toBe("token-1");
  });

  it("waits for a source that is registered but not loaded", async () => {
    setSessionSource(source({ isLoaded: false }));
    const pending = getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS - 1);
    setSessionSource(source());

    expect(await pending).toBe("token-1");
  });

  it("carries on anonymously once the wait runs out", async () => {
    const getToken = vi.fn<SessionSource["getToken"]>(() => Promise.resolve("t"));
    setSessionSource(source({ isLoaded: false, getToken }));
    const pending = getSessionToken();

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
    const first = getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS);
    await first;

    expect(await getSessionToken()).toBeNull();
  });

  it("uses Clerk if it finishes loading after the wait ran out", async () => {
    const first = getSessionToken();
    await vi.advanceTimersByTimeAsync(SIGN_IN_STATE_WAIT_MS);
    await first;
    setSessionSource(source());

    expect(await getSessionToken()).toBe("token-1");
  });

  it("answers every call that was waiting when Clerk loaded", async () => {
    const calls = [getSessionToken(), getSessionToken()];
    setSessionSource(source());

    expect(await Promise.all(calls)).toEqual(["token-1", "token-1"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
