// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "./testFixtures";
import { useUserName } from "./useUserName";

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

describe("useUserName", () => {
  // Joining an account can give the user the account's name. Without the refetch, a form would
  // keep asking for a name and the server would refuse the one it sends.
  it("refetches without going back to loading when a device user has been added, and stops on unmount", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { displayName: null }))
      .mockResolvedValueOnce(jsonResponse(200, { displayName: "Ana" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useUserName());
    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", displayName: null });
    });

    act(() => {
      added.listener?.();
    });
    expect(result.current.load).toEqual({ type: "loaded", displayName: null });

    await waitFor(() => {
      expect(result.current.load).toEqual({ type: "loaded", displayName: "Ana" });
    });
    unmount();
    expect(added.listener).toBeNull();
  });
});
