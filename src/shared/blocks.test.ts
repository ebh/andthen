import { describe, expect, it } from "vitest";

import { canBlock } from "./blocks";

describe("canBlock", () => {
  it.each([
    { userId: "u1", blockedUserId: "u2", expected: true },
    { userId: "u1", blockedUserId: "u1", expected: false },
  ])(
    "returns $expected for user $userId blocking $blockedUserId",
    ({ userId, blockedUserId, expected }) => {
      expect(canBlock(userId, blockedUserId)).toBe(expected);
    },
  );
});
