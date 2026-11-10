// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorySummary } from "../shared/api";
import { jsonResponse } from "./testFixtures";
import { useMyStories } from "./useMyStories";

const added = vi.hoisted((): { listener: (() => void) | null } => ({ listener: null }));

vi.mock("./account", () => ({
  onDeviceUserAdded: (listener: () => void) => {
    added.listener = listener;

    return () => {
      added.listener = null;
    };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const story: StorySummary = {
  id: "abc12",
  opening: "The lighthouse keeper found a letter.",
  openingAuthorId: "u1",
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
    vi.stubGlobal("fetch", () =>
      Promise.resolve(jsonResponse(200, { stories: [story], nextCursor: null })),
    );
    const { result } = renderHook(() => useMyStories());
    expect(result.current.load).toEqual({ type: "loading" });

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", stories: [story], nextCursor: null });
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
      .mockResolvedValueOnce(jsonResponse(200, { stories: [story], nextCursor: null }));
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
      expect(result.current.load).toEqual({ type: "loaded", stories: [story], nextCursor: null });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches without going back to loading when a device user has been added to the account", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { stories: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse(200, { stories: [story], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useMyStories());
    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", stories: [], nextCursor: null });
    });

    act(() => {
      added.listener?.();
    });
    expect(result.current.load).toEqual({ type: "loaded", stories: [], nextCursor: null });

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", stories: [story], nextCursor: null });
    });
  });

  it("stops listening for added device users on unmount", () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(jsonResponse(200, { stories: [], nextCursor: null })),
    );
    const { unmount } = renderHook(() => useMyStories());

    unmount();

    expect(added.listener).toBeNull();
  });

  describe("loadMore", () => {
    const second: StorySummary = { ...story, id: "def34" };

    it("appends the next page and takes its cursor", async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(200, { stories: [story], nextCursor: "c1" }))
        .mockResolvedValueOnce(jsonResponse(200, { stories: [second], nextCursor: null }));
      vi.stubGlobal("fetch", fetchMock);
      const { result } = renderHook(() => useMyStories());
      await waitFor(() => {
        expect(result.current.load.type).toBe("loaded");
      });

      act(() => {
        result.current.loadMore();
      });
      expect(result.current.moreStatus).toBe("loading");

      await waitFor(() => {
        expect(result.current.load).toEqual({
          type: "loaded",
          stories: [story, second],
          nextCursor: null,
        });
      });
      expect(result.current.moreStatus).toBe("idle");
      expect(fetchMock).toHaveBeenLastCalledWith("/api/stories?cursor=c1", expect.anything());
    });

    it("keeps the list and reports a failed page, then tries the same page again", async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(200, { stories: [story], nextCursor: "c1" }))
        .mockResolvedValueOnce(jsonResponse(500, { error: "internal_error" }))
        .mockResolvedValueOnce(jsonResponse(200, { stories: [second], nextCursor: null }));
      vi.stubGlobal("fetch", fetchMock);
      const { result } = renderHook(() => useMyStories());
      await waitFor(() => {
        expect(result.current.load.type).toBe("loaded");
      });

      act(() => {
        result.current.loadMore();
      });
      await waitFor(() => {
        expect(result.current.moreStatus).toBe("failed");
      });
      expect(result.current.load).toEqual({ type: "loaded", stories: [story], nextCursor: "c1" });

      act(() => {
        result.current.loadMore();
      });
      await waitFor(() => {
        expect(result.current.load).toMatchObject({ stories: [story, second] });
      });
      expect(fetchMock).toHaveBeenLastCalledWith("/api/stories?cursor=c1", expect.anything());
    });

    it("does nothing on the last page", async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(200, { stories: [story], nextCursor: null }));
      vi.stubGlobal("fetch", fetchMock);
      const { result } = renderHook(() => useMyStories());
      await waitFor(() => {
        expect(result.current.load.type).toBe("loaded");
      });

      act(() => {
        result.current.loadMore();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.moreStatus).toBe("idle");
    });

    it("drops a page that a reload has overtaken", async () => {
      const replies = stubReplies();
      const { result } = renderHook(() => useMyStories());
      await waitFor(() => {
        expect(replies).toHaveLength(1);
      });
      await act(async () => {
        replies[0]?.(jsonResponse(200, { stories: [story], nextCursor: "c1" }));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current.load.type).toBe("loaded");
      });
      act(() => {
        result.current.loadMore();
      });
      await waitFor(() => {
        expect(replies).toHaveLength(2);
      });
      act(() => {
        result.current.reload();
      });
      await waitFor(() => {
        expect(replies).toHaveLength(3);
      });

      await act(async () => {
        replies[2]?.(jsonResponse(200, { stories: [story], nextCursor: null }));
        await Promise.resolve();
      });
      await act(async () => {
        replies[1]?.(jsonResponse(200, { stories: [second], nextCursor: null }));
        await Promise.resolve();
      });

      expect(result.current.load).toEqual({ type: "loaded", stories: [story], nextCursor: null });
    });
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
      replies[1]?.(jsonResponse(200, { stories: [story], nextCursor: null }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.load.type).toBe("loaded");
    });
    await act(async () => {
      replies[0]?.(jsonResponse(200, { stories: [], nextCursor: null }));
      await Promise.resolve();
    });

    expect(result.current.load).toEqual({ type: "loaded", stories: [story], nextCursor: null });
  });
});
