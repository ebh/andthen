import { afterEach, describe, expect, it, vi } from "vitest";

import {
  askProvider,
  failureRefundsQuotaSlot,
  type SuggestionFailure,
  type SuggestionProvider,
  type SuggestionResult,
} from "./provider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("failureRefundsQuotaSlot", () => {
  it.each<[SuggestionFailure, boolean]>([
    ["model_error", true],
    ["unusable_output", false],
    ["timed_out", false],
  ])("for %s answers %s", (failure, refunds) => {
    expect(failureRefundsQuotaSlot(failure)).toBe(refunds);
  });
});

describe("askProvider", () => {
  it("passes the provider's result through, showing it the story", async () => {
    const result: SuggestionResult = { ok: true, suggestions: ["One.", "Two.", "Three."] };
    const suggest = vi.fn<SuggestionProvider["suggest"]>().mockResolvedValue(result);

    expect(await askProvider({ suggest }, "The story.")).toEqual(result);
    expect(suggest).toHaveBeenCalledWith("The story.");
  });

  it("turns a provider that throws into a model error and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const suggest = vi.fn<SuggestionProvider["suggest"]>().mockRejectedValue(new Error("broken"));

    expect(await askProvider({ suggest }, "s")).toEqual({ ok: false, failure: "model_error" });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
