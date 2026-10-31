import { afterEach, describe, expect, it, vi } from "vitest";

import { SUGGESTIONS_JSON_SCHEMA } from "./prompt";
import { createWorkersAiProvider, type RunModel } from "./workersAi";

const GOOD = ["One.", "Two.", "Three."];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWorkersAiProvider", () => {
  it("runs the configured model with the prompt and the JSON schema", async () => {
    const run = vi.fn<RunModel>().mockResolvedValue({ response: { suggestions: GOOD } });

    const result = await createWorkersAiProvider({ model: "@cf/test/model", run }).suggest("Story");

    expect(result).toEqual({ ok: true, suggestions: ["One.", "Two.", "Three."] });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("@cf/test/model", {
      messages: [
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "<story>\nStory\n</story>" },
      ],
      response_format: { type: "json_schema", json_schema: SUGGESTIONS_JSON_SCHEMA },
    });
  });

  it("accepts a response that is JSON text", async () => {
    const run = vi
      .fn<RunModel>()
      .mockResolvedValue({ response: JSON.stringify({ suggestions: GOOD }) });

    expect((await createWorkersAiProvider({ model: "m", run }).suggest("s")).ok).toBe(true);
  });

  it("retries once when the output has the wrong shape", async () => {
    const run = vi
      .fn<RunModel>()
      .mockResolvedValueOnce({ unexpected: true })
      .mockResolvedValueOnce({ response: { suggestions: GOOD } });

    expect((await createWorkersAiProvider({ model: "m", run }).suggest("s")).ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries once when the model reports it could not meet the schema", async () => {
    const run = vi
      .fn<RunModel>()
      .mockRejectedValueOnce(new Error("5006: JSON Mode couldn't be met"))
      .mockResolvedValueOnce({ response: { suggestions: GOOD } });

    expect((await createWorkersAiProvider({ model: "m", run }).suggest("s")).ok).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("fails without a retry on any other error, including one that is not an Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (const failure of [new Error("Quota exceeded"), "JSON Mode couldn't be met"]) {
      const run = vi.fn<RunModel>().mockRejectedValue(failure);

      expect(await createWorkersAiProvider({ model: "m", run }).suggest("s")).toEqual({
        ok: false,
      });
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
});
