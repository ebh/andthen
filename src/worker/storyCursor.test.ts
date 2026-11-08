import { describe, expect, it } from "vitest";

import { decodeStoryCursor, encodeStoryCursor } from "./storyCursor";

const cursor = { isMyTurn: true, latestAt: 1_700_000_000_000, id: "abc12" };

describe("story cursor", () => {
  it("decodes what it encoded", () => {
    expect(decodeStoryCursor(encodeStoryCursor(cursor))).toEqual(cursor);
  });

  it("encodes to URL-safe characters only", () => {
    expect(encodeStoryCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["not base64", "!!!"],
    ["base64 of text that is not JSON", btoa("hello")],
    ["JSON of the wrong shape", btoa(JSON.stringify({ id: "abc12" }))],
    ["a key whose story ID is invalid", btoa(JSON.stringify({ ...cursor, id: "x" }))],
    ["a key with a negative time", btoa(JSON.stringify({ ...cursor, latestAt: -1 }))],
  ])("refuses %s", (_name, raw) => {
    expect(decodeStoryCursor(raw)).toBeNull();
  });
});
