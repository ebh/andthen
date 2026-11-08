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

  // Pins the +/ to -_ swap and the padding strip: standard base64 would put "+", "/" or "=" in a URL.
  it.each(Array.from({ length: 120 }, (_, latestAt) => [latestAt]))(
    "round-trips latestAt %d in URL-safe characters without padding",
    (latestAt) => {
      const key = { ...cursor, latestAt };
      const encoded = encodeStoryCursor(key);

      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeStoryCursor(encoded)).toEqual(key);
    },
  );

  it.each(["???", ">>>", "a???", "ab>>>", "abc???>>>"])(
    "decodes URL-safe characters back to standard base64 (extra field %s)",
    (extra) => {
      const json = JSON.stringify({ ...cursor, extra });
      const raw = btoa(json).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

      expect(decodeStoryCursor(raw)).toEqual(cursor);
    },
  );

  it.each([
    ["an empty string", ""],
    ["a cursor with a space", `${encodeStoryCursor(cursor)} `],
    ["a cursor with a leading newline", `\n${encodeStoryCursor(cursor)}`],
    ["a cursor with padding", `${encodeStoryCursor(cursor)}=`],
    ["not base64", "!!!"],
    ["base64 of text that is not JSON", btoa("hello")],
    ["JSON of the wrong shape", btoa(JSON.stringify({ id: "abc12" }))],
    ["a key whose story ID is invalid", btoa(JSON.stringify({ ...cursor, id: "x" }))],
    ["a key with a negative time", btoa(JSON.stringify({ ...cursor, latestAt: -1 }))],
  ])("refuses %s", (_name, raw) => {
    expect(decodeStoryCursor(raw)).toBeNull();
  });
});
