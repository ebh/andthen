import { afterEach, describe, expect, it, vi } from "vitest";

import { generateSuggestions, type CompleteChat } from "./generate";
import { buildMessages } from "./prompt";

const GOOD = { suggestions: ["One.", "Two.", "Three."] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateSuggestions", () => {
  it("asks once and returns good output", async () => {
    const complete = vi.fn<CompleteChat>().mockResolvedValue(GOOD);

    const result = await generateSuggestions(complete, "The story.");

    expect(result).toEqual({ ok: true, suggestions: ["One.", "Two.", "Three."] });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(buildMessages("The story."));
  });

  it("asks again once when the output does not parse, and uses the second answer", async () => {
    const complete = vi
      .fn<CompleteChat>()
      .mockResolvedValueOnce("garbage")
      .mockResolvedValueOnce(GOOD);

    const result = await generateSuggestions(complete, "The story.");

    expect(result).toEqual({ ok: true, suggestions: ["One.", "Two.", "Three."] });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second bad answer", async () => {
    const complete = vi
      .fn<CompleteChat>()
      .mockResolvedValue({ suggestions: ["Same.", "Same.", "Same."] });

    expect(await generateSuggestions(complete, "The story.")).toEqual({ ok: false });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("treats null output from the model as a parse failure", async () => {
    const complete = vi.fn<CompleteChat>().mockResolvedValueOnce(null).mockResolvedValueOnce(GOOD);

    expect((await generateSuggestions(complete, "s")).ok).toBe(true);
  });

  it("does not retry a thrown error, and reports failure instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const complete = vi.fn<CompleteChat>().mockRejectedValue(new Error("quota"));

    expect(await generateSuggestions(complete, "The story.")).toEqual({ ok: false });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the retry itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const complete = vi
      .fn<CompleteChat>()
      .mockResolvedValueOnce("garbage")
      .mockRejectedValueOnce(new Error("x"));

    expect(await generateSuggestions(complete, "s")).toEqual({ ok: false });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
