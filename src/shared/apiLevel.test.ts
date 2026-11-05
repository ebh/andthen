import { describe, expect, it } from "vitest";

import { API_LEVEL, API_LEVEL_HEADER, MIN_API_LEVEL, parseApiLevel } from "./apiLevel";

describe("API level constants", () => {
  it("never speaks a level below the one the Worker accepts", () => {
    expect(API_LEVEL).toBeGreaterThanOrEqual(MIN_API_LEVEL);
  });

  it("starts at level 1 and names the header", () => {
    expect(API_LEVEL).toBe(1);
    expect(MIN_API_LEVEL).toBe(1);
    expect(API_LEVEL_HEADER).toBe("X-Api-Level");
  });
});

describe("parseApiLevel", () => {
  it.each([null, undefined])("reports %s as missing", (value) => {
    expect(parseApiLevel(value)).toEqual({ type: "missing" });
  });

  it.each([
    ["1", 1],
    ["2", 2],
    ["10", 10],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("reads %j as level %d", (value, level) => {
    expect(parseApiLevel(value)).toEqual({ type: "level", level });
  });

  it.each([
    ["", "empty"],
    [" ", "whitespace"],
    [" 1", "leading space"],
    ["1 ", "trailing space"],
    ["1\n", "trailing newline"],
    ["0", "zero"],
    ["-1", "negative"],
    ["+1", "explicit plus"],
    ["1.5", "fraction"],
    ["1.0", "decimal point"],
    ["1e3", "exponent"],
    ["0x10", "hex"],
    ["03", "leading zero"],
    ["00", "only zeros"],
    ["abc", "letters"],
    ["1a", "trailing letters"],
    ["9007199254740992", "above the safe integer range"],
    ["99999999999999999999", "huge"],
    ["١", "non-ASCII digit"],
  ])("reads %j (%s) as invalid", (value) => {
    expect(parseApiLevel(value)).toEqual({ type: "invalid" });
  });
});
