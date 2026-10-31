import { describe, expect, it } from "vitest";

import { describeTimeLeft } from "./format";

describe("describeTimeLeft", () => {
  it.each([
    [24 * 3_600_000 - 60_000, "23h 59m left"],
    [12 * 60_000, "12m left"],
    [59_999, "less than a minute left"],
    [0, "ending now"],
    [-5, "ending now"],
  ])("%i ms left reads %s", (left, text) => {
    expect(describeTimeLeft(1_000 + left, 1_000)).toBe(text);
  });
});
