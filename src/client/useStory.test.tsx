// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiFailure, ApiResult } from "./api";
import { ME, OTHER, jsonResponse, storyView } from "./testFixtures";
import { nextLoad, useStory, type StoryLoad } from "./useStory";

afterEach(() => {
  vi.unstubAllGlobals();
});

const view = storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME });

describe("useStory", () => {
  it("starts loading, then holds the story", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(200, view)));
    const { result } = renderHook(() => useStory("abc12"));
    expect(result.current.load).toEqual({ type: "loading" });

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", view, refreshFailed: false });
    });
  });

  it("keeps the story on screen when a reload fails, and clears the flag when one succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, view))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(200, view));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStory("abc12"));
    await waitFor(() => {
      expect(result.current.load.type).toBe("loaded");
    });

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", view, refreshFailed: true });
    });

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", view, refreshFailed: false });
    });
  });

  it("drops the reply of a request that a newer one has overtaken", async () => {
    const replies: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          replies.push(resolve);
        }),
    );
    const { result } = renderHook(() => useStory("abc12"));
    await waitFor(() => {
      expect(replies).toHaveLength(1);
    });
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => {
      expect(replies).toHaveLength(2);
    });

    await act(async () => {
      replies[1]?.(jsonResponse(200, view));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.load.type).toBe("loaded");
    });
    await act(async () => {
      replies[0]?.(jsonResponse(404, { error: "not_found" }));
      await Promise.resolve();
    });

    expect(result.current.load.type).toBe("loaded");
  });

  it("drops the reply that arrives after the page is gone", async () => {
    const replies: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          replies.push(resolve);
        }),
    );
    const { result, unmount } = renderHook(() => useStory("abc12"));
    await waitFor(() => {
      expect(replies).toHaveLength(1);
    });
    unmount();

    replies[0]?.(jsonResponse(200, view));
    await Promise.resolve();

    expect(result.current.load).toEqual({ type: "loading" });
  });
});

function failed(failure: ApiFailure): ApiResult<typeof view> {
  return { ok: false, failure };
}

describe("nextLoad", () => {
  const loaded: StoryLoad = { type: "loaded", view, refreshFailed: false };
  const loading: StoryLoad = { type: "loading" };
  const left: ApiFailure = { type: "left_story", displayName: "Ana", opening: "Once." };
  const network: ApiFailure = { type: "network" };

  it.each<[string, StoryLoad, ApiResult<typeof view>, StoryLoad]>([
    ["a story", loading, { ok: true, value: view }, loaded],
    [
      "a story after a failed reload",
      { type: "loaded", view, refreshFailed: true },
      { ok: true, value: view },
      loaded,
    ],
    [
      "a story this browser hasn't joined",
      loading,
      failed({ type: "rejected", status: 403, code: "not_participant" }),
      { type: "not_joined" },
    ],
    [
      "a story that doesn't exist",
      loading,
      failed({ type: "rejected", status: 404, code: "not_found" }),
      { type: "not_found" },
    ],
    [
      "a writer who left, on a first load",
      loading,
      failed(left),
      { type: "left", displayName: "Ana", opening: "Once." },
    ],
    [
      "a writer who left, on a reload of a loaded story",
      loaded,
      failed(left),
      { type: "left", displayName: "Ana", opening: "Once." },
    ],
    [
      "any other failure of a reload, keeping the story",
      loaded,
      failed(network),
      { type: "loaded", view, refreshFailed: true },
    ],
    [
      "any other failure of a first load",
      loading,
      failed(network),
      { type: "failed", failure: network },
    ],
  ])("moves on from %s", (_name, previous, result, expected) => {
    expect(nextLoad(previous, result)).toEqual(expected);
  });
});
