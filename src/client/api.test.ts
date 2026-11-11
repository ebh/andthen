import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { API_LEVEL } from "../shared/apiLevel";
import { pushSubscriptionIdOf } from "../shared/pushSubscriptionId";
import { getClientOutdated, setClientOutdated } from "./clientOutdated";
import {
  blockUser,
  createPassage,
  listBlocks,
  unblockUser,
  fetchMe,
  fetchVapidPublicKey,
  createStory,
  fetchStory,
  joinStory,
  leaveStory,
  listMyStories,
  rejoinStory,
  removePushSubscription,
  requestSuggestions,
  savePushSubscription,
  skipTurn,
} from "./api";
import { setSessionSource, type SessionSource } from "./sessionToken";
import { jsonResponse, noContentResponse, storyView, ME, OTHER } from "./testFixtures";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setClientOutdated(false);
});

const stories = () => jsonResponse(200, { stories: [], nextCursor: null });
const rejected = () => jsonResponse(401, { error: "invalid_session_token" });

function stubReplies(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function authorizationOf(fetchMock: ReturnType<typeof stubReplies>, call: number): unknown {
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

describe("error mapping", () => {
  it("maps a documented error body to its code and status", async () => {
    stubFetch(jsonResponse(409, { error: "stale_turn" }));

    expect(
      await createPassage("abc12", { text: "x", turnVersion: 1, startsParagraph: true }),
    ).toEqual({
      ok: false,
      failure: { type: "rejected", status: 409, code: "stale_turn" },
    });
  });

  it("maps a 409 story_full to its code", async () => {
    stubFetch(jsonResponse(409, { error: "story_full" }));

    expect(await joinStory("abc12", { displayName: "Sam" })).toEqual({
      ok: false,
      failure: { type: "rejected", status: 409, code: "story_full" },
    });
  });

  it("maps 403 left_story to the name and the opening passage", async () => {
    stubFetch(
      jsonResponse(403, {
        error: "left_story",
        displayName: "Ana",
        opening: "Once upon a time.",
        openingAuthorId: "u1",
      }),
    );

    expect(await fetchStory("abc12")).toEqual({
      ok: false,
      failure: {
        type: "left_story",
        displayName: "Ana",
        opening: "Once upon a time.",
        openingAuthorId: "u1",
      },
    });
  });

  it("maps 403 left_story from an older Worker to a failure with no opening author", async () => {
    stubFetch(
      jsonResponse(403, { error: "left_story", displayName: "Ana", opening: "Once upon a time." }),
    );

    expect(await fetchStory("abc12")).toEqual({
      ok: false,
      failure: {
        type: "left_story",
        displayName: "Ana",
        opening: "Once upon a time.",
        openingAuthorId: undefined,
      },
    });
  });

  it("treats left_story without its details as unreadable", async () => {
    stubFetch(jsonResponse(403, { error: "left_story" }));

    expect(await fetchStory("abc12")).toEqual({
      ok: false,
      failure: { type: "unreadable", status: 403 },
    });
  });

  it.each([
    ["a non-JSON body", new Response("<html>Bad gateway</html>", { status: 502 })],
    ["an error that isn't a string", jsonResponse(500, { error: 7 })],
    ["a body with no error", jsonResponse(500, { message: "oops" })],
    ["a JSON null", jsonResponse(500, null)],
  ])("treats %s as unreadable", async (_name, response) => {
    stubFetch(response);

    const result = await requestSuggestions("abc12");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.type).toBe("unreadable");
  });

  it("keeps a code from a newer Worker, with its status", async () => {
    stubFetch(jsonResponse(418, { error: "made_up" }));

    expect(await requestSuggestions("abc12")).toEqual({
      ok: false,
      failure: { type: "unknown_code", status: 418, code: "made_up" },
    });
  });

  it("maps client_outdated to its own failure and flags the app as outdated", async () => {
    stubFetch(jsonResponse(426, { error: "client_outdated" }));

    expect(getClientOutdated()).toBe(false);
    expect(await fetchStory("abc12")).toEqual({ ok: false, failure: { type: "client_outdated" } });
    expect(getClientOutdated()).toBe(true);
  });

  it("does not flag the app as outdated for any other failure", async () => {
    stubFetch(jsonResponse(409, { error: "stale_turn" }));

    await fetchStory("abc12");

    expect(getClientOutdated()).toBe(false);
  });

  it("treats a rejected fetch as a network failure", async () => {
    stubFetch(new TypeError("Failed to fetch"));

    expect(await fetchStory("abc12")).toEqual({ ok: false, failure: { type: "network" } });
  });

  it("rethrows an error that isn't a network failure", async () => {
    stubFetch(new RangeError("bug"));

    await expect(fetchStory("abc12")).rejects.toThrow("bug");
  });
});

describe("API level header", () => {
  const requests = [
    ["listMyStories", () => listMyStories(), "GET", "/api/stories"],
    [
      "createStory",
      () => createStory({ displayName: "Ana", opening: "Once." }),
      "POST",
      "/api/stories",
    ],
    ["fetchStory", () => fetchStory("abc12"), "GET", "/api/stories/abc12"],
    [
      "joinStory",
      () => joinStory("abc12", { displayName: "Sam" }),
      "POST",
      "/api/stories/abc12/participants",
    ],
    [
      "createPassage",
      () => createPassage("abc12", { text: "x", turnVersion: 1, startsParagraph: true }),
      "POST",
      "/api/stories/abc12/passages",
    ],
    ["skipTurn", () => skipTurn("abc12", 1), "POST", "/api/stories/abc12/skip"],
    ["leaveStory", () => leaveStory("abc12"), "POST", "/api/stories/abc12/leave"],
    ["rejoinStory", () => rejoinStory("abc12"), "POST", "/api/stories/abc12/rejoin"],
    [
      "requestSuggestions",
      () => requestSuggestions("abc12"),
      "POST",
      "/api/stories/abc12/suggestions",
    ],
  ] as const;

  it.each(requests)("%s sends X-Api-Level", async (_name, send, method, path) => {
    const fetchMock = stubFetch(noContentResponse());

    await send();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(path);
    expect(init?.method).toBe(method);
    expect(new Headers(init?.headers).get("X-Api-Level")).toBe(String(API_LEVEL));
  });

  it("keeps the Content-Type of a JSON request", async () => {
    const fetchMock = stubFetch(noContentResponse());

    await leaveStory("abc12");

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("blocking", () => {
  it("lists the blocks", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { blocks: [{ id: "b1", blockedUserId: "u2" }] }));

    expect(await listBlocks()).toEqual({
      ok: true,
      value: { blocks: [{ id: "b1", blockedUserId: "u2" }] },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/users/me/blocks", {
      method: "GET",
      headers: { "X-Api-Level": String(API_LEVEL) },
    });
  });

  it("treats a list in the wrong shape as unreadable", async () => {
    stubFetch(jsonResponse(200, { blocks: [{ id: "b1" }] }));

    expect(await listBlocks()).toEqual({ ok: false, failure: { type: "unreadable", status: 200 } });
  });

  it("posts the blocked user and parses the block ID from the 201", async () => {
    const fetchMock = stubFetch(jsonResponse(201, { blockId: "b1" }));

    expect(await blockUser({ blockedUserId: "u2" })).toEqual({
      ok: true,
      value: { blockId: "b1" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/users/me/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Level": String(API_LEVEL) },
      body: JSON.stringify({ blockedUserId: "u2" }),
    });
  });

  it("deletes the block with no body and accepts a 204", async () => {
    const fetchMock = stubFetch(noContentResponse());

    expect(await unblockUser("b1")).toEqual({ ok: true, value: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/users/me/blocks/b1", {
      method: "DELETE",
      headers: { "X-Api-Level": String(API_LEVEL) },
    });
  });
});

describe("success", () => {
  it("parses the story view", async () => {
    const view = storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME });
    stubFetch(jsonResponse(200, view));

    expect(await fetchStory("abc12")).toEqual({ ok: true, value: view });
  });

  it("rejects a success body that breaks the contract", async () => {
    stubFetch(jsonResponse(200, { passages: [] }));

    const result = await fetchStory("abc12");

    expect(!result.ok && result.failure).toEqual({ type: "unreadable", status: 200 });
  });

  it("reads the new passage's ID from a 201", async () => {
    const fetchMock = stubFetch(jsonResponse(201, { passageId: "c7" }));

    expect(
      await createPassage("abc12", { text: "x", turnVersion: 2, startsParagraph: true }),
    ).toEqual({
      ok: true,
      value: { passageId: "c7" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/passages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "x", turnVersion: 2, startsParagraph: true }),
      }),
    );
  });
});

describe("my stories, leaving and rejoining", () => {
  const summary = {
    id: "abc12",
    opening: "Once.",
    openingAuthorId: "u1",
    holderName: null,
    isMyTurn: false,
    endsAt: null,
    writerCount: 1,
  };

  it("asks for the page after a cursor in the query", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { stories: [], nextCursor: null }));

    await listMyStories("eyJh_-");

    expect(fetchMock).toHaveBeenCalledWith("/api/stories?cursor=eyJh_-", {
      method: "GET",
      headers: { "X-Api-Level": String(API_LEVEL) },
    });
  });

  it("parses the list of stories from GET /api/stories", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { stories: [summary], nextCursor: null }));

    expect(await listMyStories()).toEqual({
      ok: true,
      value: { stories: [summary], nextCursor: null },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/stories", {
      method: "GET",
      headers: { "X-Api-Level": String(API_LEVEL) },
    });
  });

  it.each([
    ["leaving", leaveStory, "/api/stories/abc12/leave"],
    ["rejoining", rejoinStory, "/api/stories/abc12/rejoin"],
  ])("posts an empty JSON body when %s and accepts a 204", async (_name, send, path) => {
    const fetchMock = stubFetch(noContentResponse());

    expect(await send("abc12")).toEqual({ ok: true, value: null });
    expect(fetchMock).toHaveBeenCalledWith(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Level": String(API_LEVEL) },
      body: "{}",
    });
  });
});

describe("push subscription", () => {
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) },
  };

  it("reads the public key", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { publicKey: "key" }));

    expect(await fetchVapidPublicKey()).toEqual({ ok: true, value: { publicKey: "key" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/vapid-public-key", {
      method: "GET",
      headers: { "X-Api-Level": String(API_LEVEL) },
    });
  });

  it("reads the user's display name, which is null until they have one", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { displayName: null }));

    expect(await fetchMe()).toEqual({ ok: true, value: { displayName: null } });
    expect(fetchMock).toHaveBeenCalledWith("/api/users/me", {
      method: "GET",
      headers: { "X-Api-Level": String(API_LEVEL) },
    });
  });

  it("puts the subscription as JSON and accepts a 204", async () => {
    const fetchMock = stubFetch(noContentResponse());

    expect(await savePushSubscription(subscription)).toEqual({ ok: true, value: null });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/push-subscriptions/${await pushSubscriptionIdOf(subscription.endpoint)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Api-Level": String(API_LEVEL) },
        body: JSON.stringify(subscription),
      },
    );
  });

  it("deletes at the subscription's path with no body and accepts a 204", async () => {
    const fetchMock = stubFetch(noContentResponse());

    expect(await removePushSubscription(subscription.endpoint)).toEqual({ ok: true, value: null });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/push-subscriptions/${await pushSubscriptionIdOf(subscription.endpoint)}`,
      {
        method: "DELETE",
        headers: { "X-Api-Level": String(API_LEVEL) },
      },
    );
  });

  it("reports a rejected save as a failure value", async () => {
    stubFetch(jsonResponse(403, { error: "not_participant" }));

    expect(await savePushSubscription(subscription)).toEqual({
      ok: false,
      failure: { type: "rejected", status: 403, code: "not_participant" },
    });
  });
});

describe("the session token on API calls", () => {
  it("sends no Authorization header when nobody is signed in", async () => {
    const fetchMock = stubReplies(stories());

    await listMyStories();

    expect(authorizationOf(fetchMock, 0)).toBeUndefined();
  });

  it("sends the token as a Bearer header", async () => {
    signedInAs("tok-1");
    const fetchMock = stubReplies(stories());

    await listMyStories();

    expect(authorizationOf(fetchMock, 0)).toBe("Bearer tok-1");
  });

  it("fetches a token for every call and keeps none", async () => {
    signedInAs("tok-1", "tok-2");
    const fetchMock = stubReplies(stories(), stories());

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
    const fetchMock = stubReplies(rejected(), stories());

    expect(await listMyStories()).toEqual({ ok: true, value: { stories: [], nextCursor: null } });
    expect(authorizationOf(fetchMock, 0)).toBe("Bearer stale");
    expect(authorizationOf(fetchMock, 1)).toBe("Bearer fresh");
  });

  it("reports the failure when the retry is rejected too, and retries no more", async () => {
    signedInAs("tok-1", "tok-2", "tok-3");
    const fetchMock = stubReplies(rejected(), rejected(), rejected());

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
    const fetchMock = stubReplies(rejected(), stories());

    const result = await listMyStories();

    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures", async () => {
    signedInAs("tok-1", "tok-2");
    const fetchMock = stubReplies(jsonResponse(409, { error: "stale_turn" }), stories());

    await listMyStories();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rejection of a request that carried no token", async () => {
    const fetchMock = stubReplies(rejected(), stories());

    await listMyStories();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds the request until Clerk has loaded", async () => {
    setSessionSource(null);
    const fetchMock = stubReplies(stories());

    const pending = listMyStories();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    signedInAs("tok-1");
    await pending;

    expect(authorizationOf(fetchMock, 0)).toBe("Bearer tok-1");
  });
});
