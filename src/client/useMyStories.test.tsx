// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorySummary } from "../shared/api";
import { jsonResponse } from "./testFixtures";
import { useMyStories } from "./useMyStories";

const synced = vi.hoisted((): { listener: (() => void) | null } => ({ listener: null }));

vi.mock("./account", () => ({
  onAccountSynced: (listener: () => void) => {
    synced.listener = listener;

    return () => {
      synced.listener = null;
    };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const story: StorySummary = {
  id: "abc12",
  opening: "The lighthouse keeper found a letter.",
  holderName: null,
  isMyTurn: false,
  endsAt: null,
  writerCount: 1,
};

function stubReplies() {
  const replies: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        replies.push(resolve);
      }),
  );

  return replies;
}

describe("useMyStories", () => {
  it("starts loading, then holds the stories", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(200, { stories: [story] })));
    const { result } = renderHook(() => useMyStories());
    expect(result.current.load).toEqual({ type: "loading" });

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", stories: [story] });
    });
  });

  it("reports a failed load", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(500, { error: "internal_error" })));
    const { result } = renderHook(() => useMyStories());

    await waitFor(() => {
      expect(result.current.load.type).toBe("failed");
    });
  });

  it("goes back to loading on reload, then shows the new result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(500, { error: "internal_error" }))
      .mockResolvedValueOnce(jsonResponse(200, { stories: [story] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useMyStories());
    await waitFor(() => {
      expect(result.current.load.type).toBe("failed");
    });

    act(() => {
      result.current.reload();
    });
    expect(result.current.load).toEqual({ type: "loading" });

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", stories: [story] });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches without going back to loading when the account has synced", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { stories: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { stories: [story] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useMyStories());
    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", stories: [] });
    });

    act(() => {
      synced.listener?.();
    });
    expect(result.current.load).toEqual({ type: "loaded", stories: [] });

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", stories: [story] });
    });
  });

  it("stops listening for account syncs on unmount", () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(200, { stories: [] })));
    const { unmount } = renderHook(() => useMyStories());

    unmount();

    expect(synced.listener).toBeNull();
  });

  it("drops the reply of a request that a reload has overtaken", async () => {
    const replies = stubReplies();
    const { result } = renderHook(() => useMyStories());
    await waitFor(() => {
      expect(replies).toHaveLength(1);
    });
    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(replies).toHaveLength(2);
    });

    await act(async () => {
      replies[1]?.(jsonResponse(200, { stories: [story] }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.load.type).toBe("loaded");
    });
    await act(async () => {
      replies[0]?.(jsonResponse(200, { stories: [] }));
      await Promise.resolve();
    });

    expect(result.current.load).toEqual({ type: "loaded", stories: [story] });
  });

  it("drops the reply that arrives after the page is gone", async () => {
    const replies = stubReplies();
    const { result, unmount } = renderHook(() => useMyStories());
    await waitFor(() => {
      expect(replies).toHaveLength(1);
    });
    unmount();

    replies[0]?.(jsonResponse(200, { stories: [story] }));
    await Promise.resolve();

    expect(result.current.load).toEqual({ type: "loading" });
  });
});
