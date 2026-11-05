import { afterEach, describe, expect, it, vi } from "vitest";

import { getClientOutdated, setClientOutdated, subscribeClientOutdated } from "./clientOutdated";

afterEach(() => {
  setClientOutdated(false);
});

describe("clientOutdated", () => {
  it("starts false and holds what was set", () => {
    expect(getClientOutdated()).toBe(false);

    setClientOutdated(true);
    expect(getClientOutdated()).toBe(true);

    setClientOutdated(false);
    expect(getClientOutdated()).toBe(false);
  });

  it("tells every subscriber when it changes", () => {
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    subscribeClientOutdated(first);
    subscribeClientOutdated(second);

    setClientOutdated(true);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeClientOutdated(listener);

    unsubscribe();
    setClientOutdated(true);

    expect(listener).not.toHaveBeenCalled();
  });
});
