// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./useNow";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("starts at the current time", () => {
    const { result } = renderHook(() => useNow(10_000));

    expect(result.current).toBe(1_000);
  });

  it("moves on every interval and not before", () => {
    const { result } = renderHook(() => useNow(10_000));

    act(() => {
      vi.advanceTimersByTime(9_999);
    });
    expect(result.current).toBe(1_000);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(11_000);
  });

  it("stops ticking once unmounted", () => {
    const { unmount } = renderHook(() => useNow(10_000));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
