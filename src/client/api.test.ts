import { afterEach, describe, expect, it, vi } from "vitest";

import { API_LEVEL } from "../shared/apiLevel";
import { getClientOutdated, setClientOutdated } from "./clientOutdated";
import {
  contribute,
  fetchPushKey,
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

describe("error mapping", () => {
  it("maps a documented error body to its code and status", async () => {
    stubFetch(jsonResponse(409, { error: "stale_turn" }));

    expect(await contribute("abc12", { text: "x", turnVersion: 1, startsParagraph: true })).toEqual(
      {
        ok: false,
        failure: { type: "rejected", status: 409, code: "stale_turn" },
      },
    );
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
      jsonResponse(403, { error: "left_story", displayName: "Ana", opening: "Once upon a time." }),
    );

    expect(await fetchStory("abc12")).toEqual({
      ok: false,
      failure: { type: "left_story", displayName: "Ana", opening: "Once upon a time." },
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
      "contribute",
      () => contribute("abc12", { text: "x", turnVersion: 1, startsParagraph: true }),
      "POST",
      "/api/stories/abc12/contributions",
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

describe("success", () => {
  it("parses the story view", async () => {
    const view = storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME });
    stubFetch(jsonResponse(200, view));

    expect(await fetchStory("abc12")).toEqual({ ok: true, value: view });
  });

  it("rejects a success body that breaks the contract", async () => {
    stubFetch(jsonResponse(200, { contributions: [] }));

    const result = await fetchStory("abc12");

    expect(!result.ok && result.failure).toEqual({ type: "unreadable", status: 200 });
  });

  it("accepts a 204 with no body for a contribution", async () => {
    const fetchMock = stubFetch(noContentResponse());

    expect(await contribute("abc12", { text: "x", turnVersion: 2, startsParagraph: true })).toEqual(
      {
        ok: true,
        value: null,
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/contributions",
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
    holderName: null,
    isMyTurn: false,
    endsAt: null,
    writerCount: 1,
  };

  it("parses the list of stories from GET /api/stories", async () => {
    const fetchMock = stubFetch(jsonResponse(200, { stories: [summary] }));

    expect(await listMyStories()).toEqual({ ok: true, value: { stories: [summary] } });
    expect(fetchMock).toHaveBeenCalledWith("/api/stories", {
      method: "GET",
      headers: { "X-Api-Level": "1" },
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
      headers: { "Content-Type": "application/json", "X-Api-Level": "1" },
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

    expect(await fetchPushKey()).toEqual({ ok: true, value: { publicKey: "key" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/push-subscription/key", {
      method: "GET",
      headers: { "X-Api-Level": "1" },
    });
  });

  it("puts the subscription as JSON and accepts a 204", async () => {
    const fetchMock = stubFetch(noContentResponse());

    expect(await savePushSubscription(subscription)).toEqual({ ok: true, value: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/push-subscription", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Api-Level": "1" },
      body: JSON.stringify(subscription),
    });
  });

  it("deletes by endpoint and accepts a 204", async () => {
    const fetchMock = stubFetch(noContentResponse());

    expect(await removePushSubscription(subscription.endpoint)).toEqual({ ok: true, value: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/push-subscription", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Api-Level": "1" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  });

  it("reports a rejected save as a failure value", async () => {
    stubFetch(jsonResponse(403, { error: "not_participant" }));

    expect(await savePushSubscription(subscription)).toEqual({
      ok: false,
      failure: { type: "rejected", status: 403, code: "not_participant" },
    });
  });
});
