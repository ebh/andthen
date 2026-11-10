import { describe, expect, it } from "vitest";

import { blockIdFor, isObscured, isOpeningObscured } from "./blocks";

describe("blockIdFor", () => {
  const blocks = [
    { id: "b1", blockedUserId: "u2" },
    { id: "b2", blockedUserId: "u3" },
  ];

  it("finds the block on a user", () => {
    expect(blockIdFor(blocks, "u3")).toBe("b2");
  });

  it("is null for a user with no block, and for no blocks at all", () => {
    expect(blockIdFor(blocks, "u9")).toBeNull();
    expect(blockIdFor([], "u2")).toBeNull();
  });
});

describe("isObscured", () => {
  it.each([
    {
      title: "shows an author the user has not blocked",
      status: "ready",
      blockId: null,
      own: false,
      expected: false,
    },
    { title: "hides a blocked author", status: "ready", blockId: "b1", own: false, expected: true },
    {
      title: "hides everyone else while the list loads",
      status: "loading",
      blockId: null,
      own: false,
      expected: true,
    },
    {
      title: "hides everyone else when the list failed",
      status: "failed",
      blockId: null,
      own: false,
      expected: true,
    },
    {
      title: "never hides the user's own passage",
      status: "loading",
      blockId: null,
      own: true,
      expected: false,
    },
  ] as const)("$title", ({ status, blockId, own, expected }) => {
    expect(isObscured(status, blockId, own)).toBe(expected);
  });
});

describe("isOpeningObscured", () => {
  const blocks = {
    status: "ready" as const,
    blockIdFor: (userId: string) => (userId === "u2" ? "b1" : null),
  };

  it.each([
    {
      title: "shows an opening by an author who is not blocked",
      blocks,
      authorId: "u3",
      expected: false,
    },
    { title: "hides an opening by a blocked author", blocks, authorId: "u2", expected: true },
    {
      title: "hides an opening while the list loads",
      blocks: { ...blocks, status: "loading" as const },
      authorId: "u3",
      expected: true,
    },
    {
      title: "hides an opening whose author is unknown, even when the list is ready",
      blocks,
      authorId: undefined,
      expected: true,
    },
  ])("$title", ({ blocks: given, authorId, expected }) => {
    expect(isOpeningObscured(given, authorId)).toBe(expected);
  });
});
