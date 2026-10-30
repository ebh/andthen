import { describe, expect, it } from "vitest";

import { newId, newStoryId } from "./ids";

const bytesFrom = (...batches: number[][]) => {
  const remaining = [...batches];
  const requested: number[] = [];

  return {
    requested,
    randomBytes: (length: number) => {
      requested.push(length);
      return Uint8Array.from(remaining.shift() ?? []);
    },
  };
};

describe("newStoryId", () => {
  it("maps bytes onto a-z then 0-9", () => {
    expect(newStoryId(bytesFrom([0, 1, 25, 26, 35]).randomBytes)).toBe("abz09");
  });

  it("wraps a byte past the alphabet, up to the last unbiased one (251)", () => {
    expect(newStoryId(bytesFrom([36, 37, 71, 72, 251]).randomBytes)).toBe("ab9a9");
  });

  it("skips bytes from 252 up, and asks only for the characters still missing", () => {
    const { randomBytes, requested } = bytesFrom([252, 255, 5, 252], [3, 4], [0], [1]);

    expect(newStoryId(randomBytes)).toBe("fdeab");
    expect(requested).toEqual([5, 4, 2, 1]);
  });

  it("produces 5 characters from [a-z0-9] with the real random source", () => {
    const ids = Array.from({ length: 50 }, () => newStoryId());

    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]{5}$/);
    }
    expect(new Set(ids).size).toBeGreaterThan(40);
  });
});

describe("newId", () => {
  it("returns a different UUID each time", () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(newId());
  });
});
