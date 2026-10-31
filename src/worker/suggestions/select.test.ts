import { describe, expect, it, vi } from "vitest";

import { DEFAULT_AI_MODEL, SUGGESTION_TIMEOUT_MS } from "../config";
import { FAKE_SUGGESTIONS, fakeProvider } from "./fake";
import { type RunModel } from "./workersAi";
import { selectSuggestionProvider } from "./select";

// Only the fields the selector reads exist; the rest of Env is bindings it never touches.
function envWith(vars: object, run = vi.fn<RunModel>()): Env {
  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), vars, { AI: { run } });
}

describe("selectSuggestionProvider", () => {
  it("picks the fake provider for AI_PROVIDER=fake", () => {
    expect(selectSuggestionProvider(envWith({ AI_PROVIDER: "fake" }))).toBe(fakeProvider);
  });

  it("answers with the fixed suggestions", async () => {
    const result = await fakeProvider.suggest("anything");

    expect(result).toEqual({ ok: true, suggestions: FAKE_SUGGESTIONS });
    expect(new Set(FAKE_SUGGESTIONS).size).toBe(3);
  });

  it("picks Workers AI for AI_PROVIDER=workers-ai, with the default or the configured model", async () => {
    const run = vi.fn<RunModel>().mockResolvedValue({ response: { suggestions: ["a", "b", "c"] } });

    await selectSuggestionProvider(envWith({ AI_PROVIDER: "workers-ai" }, run)).suggest("s");
    await selectSuggestionProvider(
      envWith({ AI_PROVIDER: "workers-ai", AI_MODEL: "@cf/x/y" }, run),
    ).suggest("s");

    expect(run.mock.calls.map(([model]) => model)).toEqual([DEFAULT_AI_MODEL, "@cf/x/y"]);
  });

  it("gives up on a hung Workers AI call after SUGGESTION_TIMEOUT_MS, not before", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const run = vi.fn<RunModel>().mockReturnValue(new Promise(() => undefined));
    const pending = selectSuggestionProvider(envWith({ AI_PROVIDER: "workers-ai" }, run)).suggest(
      "s",
    );

    await vi.advanceTimersByTimeAsync(SUGGESTION_TIMEOUT_MS - 1);
    expect(await Promise.race([pending, Promise.resolve("waiting")])).toBe("waiting");

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, failure: "timed_out" });
    vi.useRealTimers();
  });

  it("throws a clear error for a bad AI_PROVIDER", () => {
    expect(() => selectSuggestionProvider(envWith({ AI_PROVIDER: "nope" }))).toThrow(
      /Invalid AI config/,
    );
  });

  it("parses the config once per env", () => {
    const env = envWith({ AI_PROVIDER: "workers-ai" });

    expect(selectSuggestionProvider(env)).toBe(selectSuggestionProvider(env));
  });
});
