import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SuggestionProvider, SuggestionResult } from "./provider";
import { withTimeout } from "./timeout";

const GOOD: SuggestionResult = { ok: true, suggestions: ["a", "b", "c"] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withTimeout", () => {
  it("passes a prompt answer through and leaves no timer behind", async () => {
    const provider: SuggestionProvider = { suggest: () => Promise.resolve(GOOD) };

    expect(await withTimeout(provider, 1000).suggest("s")).toEqual(GOOD);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports failure when the provider is still working at the deadline", async () => {
    const provider: SuggestionProvider = { suggest: () => new Promise(() => undefined) };
    const pending = withTimeout(provider, 1000).suggest("s");

    await vi.advanceTimersByTimeAsync(999);
    expect(await Promise.race([pending, Promise.resolve("still waiting")])).toBe("still waiting");

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false });
  });

  it("passes the story text on", async () => {
    const suggest = vi.fn<SuggestionProvider["suggest"]>().mockResolvedValue(GOOD);

    await withTimeout({ suggest }, 1000).suggest("the story");

    expect(suggest).toHaveBeenCalledWith("the story");
  });
});
