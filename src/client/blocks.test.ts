import { describe, expect, it } from "vitest";

import {
  BLOCKS_LOADING,
  blockIdFor,
  blockRequest,
  isObscured,
  isOpeningObscured,
  nextBlocksLoad,
  revealFor,
} from "./blocks";

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

describe("revealFor", () => {
  const shown = { blockId: "b1", shown: true };

  it.each([
    {
      title: "keeps a reveal when a reload finds the same block",
      reveal: shown,
      blockId: "b1",
      expected: shown,
    },
    {
      title: "hides again when the block is a new one",
      reveal: shown,
      blockId: "b2",
      expected: { blockId: "b2", shown: false },
    },
    {
      title: "hides again when the block is gone",
      reveal: shown,
      blockId: null,
      expected: { blockId: null, shown: false },
    },
  ])("$title", ({ reveal, blockId, expected }) => {
    expect(revealFor(reveal, blockId)).toEqual(expected);
  });

  it("returns the same object when nothing changed", () => {
    expect(revealFor(shown, "b1")).toBe(shown);
  });
});

describe("nextBlocksLoad", () => {
  const known = { status: "ready" as const, blocks: [{ id: "b1", blockedUserId: "u2" }] };
  const offline = { ok: false as const, failure: { type: "network" as const } };

  it.each([
    {
      title: "is ready with the list that arrived",
      previous: BLOCKS_LOADING,
      result: { ok: true as const, value: { blocks: known.blocks } },
      expected: known,
    },
    {
      title: "replaces the old list with the one that arrived",
      previous: known,
      result: { ok: true as const, value: { blocks: [] } },
      expected: { status: "ready", blocks: [] },
    },
    {
      title: "keeps the old list but is failed when a reload does not arrive",
      previous: known,
      result: offline,
      expected: { status: "failed", blocks: known.blocks },
    },
    {
      title: "is failed with no list when the first load does not arrive",
      previous: BLOCKS_LOADING,
      result: offline,
      expected: { status: "failed", blocks: [] },
    },
  ])("$title", ({ previous, result, expected }) => {
    expect(nextBlocksLoad(previous, result)).toEqual(expected);
  });
});

describe("blockRequest", () => {
  const blocks = [{ id: "b1", blockedUserId: "u2" }];
  const calls = {
    blockUser: (request: { blockedUserId: string }) => `block ${request.blockedUserId}`,
    unblockUser: (blockId: string) => `unblock ${blockId}`,
  };

  it.each([
    { title: "blocks a user", action: "block", userId: "u3", expected: "block u3" },
    { title: "blocks again a blocked user", action: "block", userId: "u2", expected: "block u2" },
    {
      title: "unblocks by the block's ID",
      action: "unblock",
      userId: "u2",
      expected: "unblock b1",
    },
    {
      title: "sends nothing to unblock a user who is not blocked",
      action: "unblock",
      userId: "u3",
      expected: null,
    },
  ] as const)("$title", ({ action, userId, expected }) => {
    const request = blockRequest(action, blocks, { id: userId }, calls);

    expect(request === null ? null : request()).toBe(expected);
  });
});
