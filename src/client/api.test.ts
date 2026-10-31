import { afterEach, describe, expect, it, vi } from "vitest";

import { contribute, fetchStory, joinStory, requestSuggestions } from "./api";
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
});

describe("error mapping", () => {
  it("maps a documented error body to its code and status", async () => {
    stubFetch(jsonResponse(409, { error: "stale_turn" }));

    expect(await contribute("abc12", { text: "x", turnVersion: 1 })).toEqual({
      ok: false,
      failure: { type: "rejected", status: 409, code: "stale_turn" },
    });
  });

  it("accepts story_full even though the shared schema may not list it", async () => {
    stubFetch(jsonResponse(409, { error: "story_full" }));

    expect(await joinStory("abc12", { displayName: "Sam" })).toEqual({
      ok: false,
      failure: { type: "rejected", status: 409, code: "story_full" },
    });
  });

  it.each([
    ["an unknown code", jsonResponse(500, { error: "made_up" })],
    ["a non-JSON body", new Response("<html>Bad gateway</html>", { status: 502 })],
  ])("treats %s as unreadable", async (_name, response) => {
    stubFetch(response);

    const result = await requestSuggestions("abc12");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.type).toBe("unreadable");
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

    expect(await contribute("abc12", { text: "x", turnVersion: 2 })).toEqual({
      ok: true,
      value: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/contributions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "x", turnVersion: 2 }),
      }),
    );
  });
});
