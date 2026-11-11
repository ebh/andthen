import { describe, expect, it } from "vitest";

import type { StorySummary } from "../shared/api";
import { describeStatus, describeTimeLeft } from "./format";

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

describe("describeStatus", () => {
  const NOW = 1_000;
  const story: StorySummary = {
    id: "s1",
    opening: "Once upon a time.",
    holderName: "Ben",
    isMyTurn: false,
    endsAt: NOW + 12 * 60_000,
    writerCount: 3,
  };

  it.each([
    ["nobody holds the turn", { holderName: null }],
    ["there is no end time", { endsAt: null }],
  ])("says the story is waiting when %s", (_, change) => {
    expect(describeStatus({ ...story, ...change }, NOW)).toBe("Waiting for someone to join");
  });

  it("shows the time left on the viewer's turn", () => {
    expect(describeStatus({ ...story, isMyTurn: true }, NOW)).toBe("Your turn · 12m left");
  });

  it("names the holder and counts the writers on another's turn", () => {
    expect(describeStatus(story, NOW)).toBe("Ben’s turn · 3 writers");
  });
});
