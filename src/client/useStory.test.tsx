// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ME, OTHER, jsonResponse, storyView } from "./testFixtures";
import { useStory } from "./useStory";

afterEach(() => {
  vi.unstubAllGlobals();
});

const leftStoryBody = {
  error: "left_story",
  displayName: "Ana",
  opening: "Once.",
  openingAuthorId: "u1",
};
const left = {
  type: "left",
  displayName: "Ana",
  opening: "Once.",
  openingAuthorId: "u1",
};

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

  it("reports a story this browser hasn't joined", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(403, { error: "not_participant" })));
    const { result } = renderHook(() => useStory("abc12"));

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "not_joined" });
    });
  });

  it("reports a story that doesn't exist", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(404, { error: "not_found" })));
    const { result } = renderHook(() => useStory("abc12"));

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "not_found" });
    });
  });

  it("reports a writer who left the story, with the name and opening to rejoin with", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(403, leftStoryBody)));
    const { result } = renderHook(() => useStory("abc12"));

    await waitFor(() => {
      expect(result.current.load).toEqual(left);
    });
  });

  it("reports a writer who left with no opening author when an older Worker sends none", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        jsonResponse(403, { error: "left_story", displayName: "Ana", opening: "Once." }),
      ),
    );
    const { result } = renderHook(() => useStory("abc12"));

    await waitFor(() => {
      expect(result.current.load).toEqual({
        type: "left",
        displayName: "Ana",
        opening: "Once.",
        openingAuthorId: undefined,
      });
    });
  });

  it("moves a loaded story to the rejoin screen when a reload finds the writer left", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, view))
      .mockResolvedValueOnce(jsonResponse(403, leftStoryBody));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useStory("abc12"));
    await waitFor(() => {
      expect(result.current.load.type).toBe("loaded");
    });

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.load).toEqual(left);
    });
  });

  it("reports a failed first load", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    const { result } = renderHook(() => useStory("abc12"));

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "failed", failure: { type: "network" } });
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
