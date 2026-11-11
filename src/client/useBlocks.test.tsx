// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addDeviceUserToAccount, announceSignedOut } from "./account";
import { jsonResponse, noContentResponse } from "./testFixtures";
import { BlocksProvider, useBlocks } from "./useBlocks";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

function calls(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string[] {
  return fetchMock.mock.calls.map(
    ([url, init]) => `${init?.method ?? "GET"} ${typeof url === "string" ? url : ""}`,
  );
}

describe("useBlocks", () => {
  it("throws outside a BlocksProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useBlocks())).toThrow("BlocksProvider");
  });

  // Pins the wiring of the hook to the API and to the account events. The rules it applies are
  // unit tested in blocks.test.ts; without this the page could not change or reload its blocks.
  it("loads, blocks, unblocks, recovers from failures, and follows the account", async () => {
    const block = Promise.withResolvers<Response>();
    const blockRelist = Promise.withResolvers<Response>();
    const retry = Promise.withResolvers<Response>();
    const afterSignOut = Promise.withResolvers<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(listOf())
      .mockReturnValueOnce(block.promise)
      .mockReturnValueOnce(blockRelist.promise)
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(listOf())
      .mockResolvedValueOnce(jsonResponse(404, { error: "not_found" }))
      .mockReturnValueOnce(retry.promise)
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(201, { blockId: "b1" }))
      .mockResolvedValueOnce(listOf("u2"))
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(listOf("u2", "u3"))
      .mockReturnValueOnce(afterSignOut.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBlocks(), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });

    // Block: what is out shows until the list has reloaded, and a second change is ignored.
    act(() => {
      result.current.block(ben);
      result.current.block({ id: "u3", name: "Cat" });
    });
    expect(result.current.working).toBe("Blocking…");
    block.resolve(jsonResponse(201, { blockId: "b1" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(result.current.working).toBe("Blocking…");
    expect(result.current.blockIdFor("u2")).toBeNull();
    blockRelist.resolve(listOf("u2"));
    await waitFor(() => {
      expect(result.current.working).toBeNull();
    });
    expect(result.current.blockIdFor("u2")).toBe("b1");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"blockedUserId":"u2"}');

    // Unblock: by the block's ID.
    act(() => {
      result.current.unblock(ben);
    });
    expect(result.current.working).toBe("Unblocking…");
    await waitFor(() => {
      expect(result.current.working).toBeNull();
    });
    expect(result.current.blockIdFor("u2")).toBeNull();

    // A refused change reports why and keeps the list; the next attempt clears the report.
    act(() => {
      result.current.block(ben);
    });
    await waitFor(() => {
      expect(result.current.error).toBe("Couldn't block. Reload the page.");
    });
    expect(result.current.status).toBe("ready");
    act(() => {
      result.current.block(ben);
    });
    expect(result.current.error).toBeNull();

    // A list that cannot be reloaded after a change is failed, not ready.
    retry.resolve(jsonResponse(201, { blockId: "b1" }));
    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
    expect(result.current.working).toBeNull();

    // The next change recovers it.
    act(() => {
      result.current.block(ben);
    });
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.blockIdFor("u2")).toBe("b1");

    // Joining an account reloads the list.
    await act(async () => {
      await addDeviceUserToAccount();
    });
    await waitFor(() => {
      expect(result.current.blockIdFor("u3")).toBe("b2");
    });

    // Sign-out drops the list at once, then the new user's list replaces it.
    act(() => {
      announceSignedOut();
    });
    expect(result.current.status).toBe("loading");
    expect(result.current.blockIdFor("u2")).toBeNull();
    afterSignOut.resolve(listOf("u4"));
    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.blockIdFor("u4")).toBe("b1");
    expect(calls(fetchMock)).toEqual([
      "GET /api/users/me/blocks",
      "POST /api/users/me/blocks",
      "GET /api/users/me/blocks",
      "DELETE /api/users/me/blocks/b1",
      "GET /api/users/me/blocks",
      "POST /api/users/me/blocks",
      "POST /api/users/me/blocks",
      "GET /api/users/me/blocks",
      "POST /api/users/me/blocks",
      "GET /api/users/me/blocks",
      "PUT /api/users/me/account",
      "GET /api/users/me/blocks",
      "GET /api/users/me/blocks",
    ]);
  });

  // Pins that an overtaken reply is dropped and that a reply after unmount is ignored without a
  // warning; without it a slow reply would put an old user's blocks on screen.
  it("ignores a reply that a newer request has overtaken, and one that arrives after unmount", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const slow = Promise.withResolvers<Response>();
    const late = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockReturnValueOnce(slow.promise)
        .mockResolvedValueOnce(listOf("u3"))
        .mockReturnValueOnce(late.promise),
    );
    const { result, unmount } = renderHook(() => useBlocks(), { wrapper });

    act(() => {
      announceSignedOut();
    });
    await waitFor(() => {
      expect(result.current.blockIdFor("u3")).toBe("b1");
    });
    await act(async () => {
      slow.resolve(listOf("u2"));
      await slow.promise;
    });
    expect(result.current.blockIdFor("u2")).toBeNull();
    expect(result.current.blockIdFor("u3")).toBe("b1");

    act(() => {
      announceSignedOut();
    });
    unmount();
    await act(async () => {
      late.resolve(listOf("u2"));
      await late.promise;
    });

    expect(result.current.status).toBe("loading");
    expect(error).not.toHaveBeenCalled();
  });
});
