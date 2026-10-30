import { describe, expect, it } from "vitest";

import { normaliseStoryId } from "./validation";

describe("normaliseStoryId", () => {
  it("lowercases a valid ID", () => {
    expect(normaliseStoryId("AbC12")).toBe("abc12");
  });

  it.each(["abc1", "abc123", "abc-1", "", " abc12"])("rejects %j", (raw) => {
    expect(normaliseStoryId(raw)).toBeNull();
  });
});
