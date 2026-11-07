import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { listMyStories } from "./api";
import { resetSessionSource, setSessionSource, type SessionSource } from "./sessionToken";
import { jsonResponse } from "./testFixtures";

const stories = () => jsonResponse(200, { stories: [] });
const rejected = () => jsonResponse(401, { error: "invalid_session_token" });

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function authorizationOf(fetchMock: ReturnType<typeof stubFetch>, call: number): unknown {
  const headers = z.record(z.string(), z.string()).parse(fetchMock.mock.calls[call]?.[1]?.headers);

  return headers["Authorization"];
}

function signedInAs(...tokens: string[]): SessionSource["getToken"] {
  const getToken = vi.fn<SessionSource["getToken"]>();
  for (const token of tokens) {
    getToken.mockResolvedValueOnce(token);
  }
  setSessionSource({ isLoaded: true, getToken });

  return getToken;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the session token on API calls", () => {
  it("sends no Authorization header when nobody is signed in", async () => {
    const fetchMock = stubFetch(stories());

    await listMyStories();

    expect(authorizationOf(fetchMock, 0)).toBeUndefined();
  });

  it("sends the token as a Bearer header", async () => {
    signedInAs("tok-1");
    const fetchMock = stubFetch(stories());

    await listMyStories();

    expect(authorizationOf(fetchMock, 0)).toBe("Bearer tok-1");
  });

  it("fetches a token for every call and keeps none", async () => {
    signedInAs("tok-1", "tok-2");
    const fetchMock = stubFetch(stories(), stories());

    await listMyStories();
    await listMyStories();

    expect(authorizationOf(fetchMock, 0)).toBe("Bearer tok-1");
    expect(authorizationOf(fetchMock, 1)).toBe("Bearer tok-2");
  });

  it("retries once with a fresh token when the Worker rejects the token", async () => {
    setSessionSource({
      isLoaded: true,
      getToken: (options) => Promise.resolve(options?.skipCache === true ? "fresh" : "stale"),
    });
    const fetchMock = stubFetch(rejected(), stories());

    expect(await listMyStories()).toEqual({ ok: true, value: { stories: [] } });
    expect(authorizationOf(fetchMock, 0)).toBe("Bearer stale");
    expect(authorizationOf(fetchMock, 1)).toBe("Bearer fresh");
  });

  it("reports the failure when the retry is rejected too, and retries no more", async () => {
    signedInAs("tok-1", "tok-2", "tok-3");
    const fetchMock = stubFetch(rejected(), rejected(), rejected());

    expect(await listMyStories()).toEqual({
      ok: false,
      failure: { type: "rejected", status: 401, code: "invalid_session_token" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the rejection when Clerk has no fresh token to retry with", async () => {
    setSessionSource({
      isLoaded: true,
      getToken: (options) => Promise.resolve(options?.skipCache === true ? null : "stale"),
    });
    const fetchMock = stubFetch(rejected(), stories());

    const result = await listMyStories();

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures", async () => {
    signedInAs("tok-1", "tok-2");
    const fetchMock = stubFetch(jsonResponse(409, { error: "stale_turn" }), stories());

    await listMyStories();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rejection of a request that carried no token", async () => {
    const fetchMock = stubFetch(rejected(), stories());

    await listMyStories();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds the request until Clerk has loaded", async () => {
    resetSessionSource();
    const fetchMock = stubFetch(stories());

    const pending = listMyStories();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    signedInAs("tok-1");
    await pending;

    expect(authorizationOf(fetchMock, 0)).toBe("Bearer tok-1");
  });
});
