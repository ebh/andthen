// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, noContentResponse } from "./testFixtures";
import { BlocksProvider, useBlocks } from "./useBlocks";

const account = vi.hoisted(
  (): { deviceUserAdded: (() => void) | null; signedOut: (() => void) | null } => ({
    deviceUserAdded: null,
    signedOut: null,
  }),
);

vi.mock("./account", () => ({
  onDeviceUserAdded: (listener: () => void) => {
    account.deviceUserAdded = listener;

    return () => {
      account.deviceUserAdded = null;
    };
  },
  onSignedOut: (listener: () => void) => {
    account.signedOut = listener;

    return () => {
      account.signedOut = null;
    };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function announce(listener: (() => void) | null): void {
  act(() => {
    listener?.();
  });
}

const ben = { id: "u2", name: "Ben" };

function wrapper({ children }: { children: ReactNode }) {
  return <BlocksProvider>{children}</BlocksProvider>;
}

function listOf(...blockedUserIds: string[]): Response {
  return jsonResponse(200, {
    blocks: blockedUserIds.map((blockedUserId, index) => ({
      id: `b${(index + 1).toString()}`,
      blockedUserId,
    })),
  });
}

function calls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string[][] {
  return fetchMock.mock.calls.map(([url, init]) => [
    typeof url === "string" ? url : "",
    init?.method ?? "GET",
  ]);
}

async function loaded(fetchMock: typeof fetch) {
  vi.stubGlobal("fetch", fetchMock);
  const hook = renderHook(() => useBlocks(), { wrapper });
  await waitFor(() => {
    expect(hook.result.current.status).not.toBe("loading");
  });

  return hook;
}

describe("useBlocks", () => {
  it("throws outside a BlocksProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useBlocks())).toThrow("BlocksProvider");
  });

  it("starts loading, then answers who is blocked", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(listOf("u2")));
    const { result } = renderHook(() => useBlocks(), { wrapper });
    expect(result.current.status).toBe("loading");

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.blockIdFor("u2")).toBe("b1");
    expect(result.current.blockIdFor("u3")).toBeNull();
  });

  it("is failed when the list does not arrive", async () => {
    const { result } = await loaded(vi.fn(() => Promise.reject(new TypeError("offline"))));

    expect(result.current.status).toBe("failed");
  });

  it("blocks, shows what is out until the list has reloaded, then reflects the new block", async () => {
    const reply = Promise.withResolvers<Response>();
    const relist = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf())
      .mockReturnValueOnce(reply.promise)
      .mockReturnValueOnce(relist.promise);
    const { result } = await loaded(fetchMock);

    act(() => {
      result.current.block(ben);
    });
    expect(result.current.working).toBe("Blocking…");

    reply.resolve(jsonResponse(201, { blockId: "b1" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(result.current.working).toBe("Blocking…");
    expect(result.current.blockIdFor("u2")).toBeNull();

    relist.resolve(listOf("u2"));
    await waitFor(() => {
      expect(result.current.working).toBeNull();
    });
    expect(result.current.blockIdFor("u2")).toBe("b1");
    expect(calls(fetchMock)).toEqual([
      ["/api/users/me/blocks", "GET"],
      ["/api/users/me/blocks", "POST"],
      ["/api/users/me/blocks", "GET"],
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"blockedUserId":"u2"}');
  });

  it("unblocks by the block's ID and reloads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf("u2"))
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(listOf());
    const { result } = await loaded(fetchMock);

    act(() => {
      result.current.unblock(ben);
    });
    expect(result.current.working).toBe("Unblocking…");

    await waitFor(() => {
      expect(result.current.blockIdFor("u2")).toBeNull();
    });
    expect(calls(fetchMock)).toEqual([
      ["/api/users/me/blocks", "GET"],
      ["/api/users/me/blocks/b1", "DELETE"],
      ["/api/users/me/blocks", "GET"],
    ]);
  });

  it("sends nothing when asked to unblock a user who is not blocked", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(listOf());
    const { result } = await loaded(fetchMock);

    act(() => {
      result.current.unblock(ben);
    });

    expect(result.current.working).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a second change while one is out", async () => {
    const reply = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf())
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValue(listOf("u2"));
    const { result } = await loaded(fetchMock);

    act(() => {
      result.current.block(ben);
      result.current.block({ id: "u3", name: "Cat" });
    });

    expect(result.current.working).toBe("Blocking…");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    reply.resolve(jsonResponse(201, { blockId: "b1" }));
    await waitFor(() => {
      expect(result.current.working).toBeNull();
    });
    expect(calls(fetchMock)).toEqual([
      ["/api/users/me/blocks", "GET"],
      ["/api/users/me/blocks", "POST"],
      ["/api/users/me/blocks", "GET"],
    ]);
  });

  it("reports a failure, keeps the list, and clears the failure on the next attempt", async () => {
    const reply = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf())
      .mockResolvedValueOnce(jsonResponse(404, { error: "not_found" }))
      .mockReturnValueOnce(reply.promise);
    const { result } = await loaded(fetchMock);

    act(() => {
      result.current.block(ben);
    });
    await waitFor(() => {
      expect(result.current.error).toBe("Couldn't block. Reload the page.");
    });
    expect(result.current.working).toBeNull();
    expect(result.current.status).toBe("ready");

    act(() => {
      result.current.block(ben);
    });
    expect(result.current.error).toBeNull();

    reply.resolve(jsonResponse(400, { error: "cannot_block_self" }));
    await waitFor(() => {
      expect(result.current.error).toBe("Couldn't block. That's you.");
    });
  });

  it("is failed, not ready, when the list cannot be reloaded after a change", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf())
      .mockResolvedValueOnce(jsonResponse(201, { blockId: "b1" }))
      .mockRejectedValueOnce(new TypeError("offline"));
    const { result } = await loaded(fetchMock);

    act(() => {
      result.current.block(ben);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
    expect(result.current.working).toBeNull();
  });

  it("recovers from a failed load on the next change", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(201, { blockId: "b1" }))
      .mockResolvedValueOnce(listOf("u2"));
    const { result } = await loaded(fetchMock);
    expect(result.current.status).toBe("failed");

    act(() => {
      result.current.block(ben);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.blockIdFor("u2")).toBe("b1");
  });

  it("reloads the list when a device user is added to an account", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf("u2"))
      .mockResolvedValueOnce(listOf("u2", "u3"));
    const { result } = await loaded(fetchMock);
    expect(result.current.blockIdFor("u3")).toBeNull();

    announce(account.deviceUserAdded);

    await waitFor(() => {
      expect(result.current.blockIdFor("u3")).toBe("b2");
    });
    expect(result.current.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops the list at once on sign-out, then replaces it with the new user's list", async () => {
    const relist = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf("u2"))
      .mockReturnValueOnce(relist.promise);
    const { result } = await loaded(fetchMock);
    expect(result.current.blockIdFor("u2")).toBe("b1");

    announce(account.signedOut);

    expect(result.current.status).toBe("loading");
    expect(result.current.blockIdFor("u2")).toBeNull();

    relist.resolve(listOf("u3"));
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.blockIdFor("u3")).toBe("b1");
    expect(result.current.blockIdFor("u2")).toBeNull();
  });

  it("ignores a reply that a newer request has overtaken", async () => {
    const slow = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(listOf("u3"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBlocks(), { wrapper });

    announce(account.deviceUserAdded);
    await waitFor(() => {
      expect(result.current.blockIdFor("u3")).toBe("b1");
    });

    await act(async () => {
      slow.resolve(listOf("u2"));
      await slow.promise;
    });

    expect(result.current.blockIdFor("u2")).toBeNull();
    expect(result.current.blockIdFor("u3")).toBe("b1");
    expect(result.current.status).toBe("ready");
  });

  it("ignores a reply that arrives after unmount, without a warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const slow = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => slow.promise),
    );
    const { result, unmount } = renderHook(() => useBlocks(), { wrapper });

    unmount();
    await act(async () => {
      slow.resolve(listOf("u2"));
      await slow.promise;
    });

    expect(result.current.status).toBe("loading");
    expect(result.current.blockIdFor("u2")).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});
