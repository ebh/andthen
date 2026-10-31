import { describe, expect, it } from "vitest";

import { DEFAULT_AI_MODEL, parseAiConfig, SUGGESTION_LIMIT, SUGGESTION_WINDOW_MS } from "./config";

describe("suggestion limits", () => {
  it("pins the agreed values: 3 requests per rolling hour", () => {
    expect(SUGGESTION_LIMIT).toBe(3);
    expect(SUGGESTION_WINDOW_MS).toBe(3_600_000);
  });
});

describe("parseAiConfig", () => {
  it("accepts each provider and defaults the model", () => {
    expect(parseAiConfig({ AI_PROVIDER: "fake" })).toEqual({
      AI_PROVIDER: "fake",
      AI_MODEL: DEFAULT_AI_MODEL,
    });
    expect(parseAiConfig({ AI_PROVIDER: "workers-ai", AI_MODEL: undefined }).AI_MODEL).toBe(
      DEFAULT_AI_MODEL,
    );
  });

  it("takes the model from AI_MODEL", () => {
    expect(parseAiConfig({ AI_PROVIDER: "workers-ai", AI_MODEL: "@cf/x/y" }).AI_MODEL).toBe(
      "@cf/x/y",
    );
  });

  it("fails fast, naming the variable, on a bad provider", () => {
    for (const bad of [undefined, "", "openai", "FAKE"]) {
      expect(() => parseAiConfig({ AI_PROVIDER: bad })).toThrow(
        /Invalid AI config[\s\S]*AI_PROVIDER/,
      );
    }
  });

  it("fails fast on an empty or non-string model", () => {
    for (const bad of ["", 3, null]) {
      expect(() => parseAiConfig({ AI_PROVIDER: "fake", AI_MODEL: bad })).toThrow(/AI_MODEL/);
    }
  });
});
