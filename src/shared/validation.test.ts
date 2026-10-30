import { describe, expect, it } from "vitest";

import { normaliseStoryId } from "./validation";

describe("normaliseStoryId", () => {
  it("keeps a lowercase ID as is", () => {
    expect(normaliseStoryId("abc12")).toBe("abc12");
  });

  it("lowercases uppercase ASCII", () => {
    expect(normaliseStoryId("ABC12")).toBe("abc12");
    expect(normaliseStoryId("AbC12")).toBe("abc12");
  });

  // U+212A KELVIN SIGN lowercases to ASCII "k"; accepting it would alias "Kabc1" to "kabc1".
  it("rejects a non-ASCII letter that lowercases to ASCII", () => {
    expect(normaliseStoryId("Kabc1")).toBeNull();
  });

  it.each(["abc1", "abc123", "abc-1", "", " abc12", "abc12 "])("rejects %j", (raw) => {
    expect(normaliseStoryId(raw)).toBeNull();
  });
});
