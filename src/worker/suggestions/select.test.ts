import { describe, expect, it, vi } from "vitest";

import { DEFAULT_AI_MODEL } from "../config";
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
