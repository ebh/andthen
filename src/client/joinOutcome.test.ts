import { describe, expect, it } from "vitest";

import type { ApiFailure } from "./api";
import { joinOutcome } from "./joinOutcome";

describe("joinOutcome", () => {
  it("treats a successful join as joined", () => {
    expect(joinOutcome({ ok: true, value: {} })).toEqual({ type: "joined" });
  });

  it("treats already_joined as joined: another tab got there first", () => {
    const failure: ApiFailure = { type: "rejected", status: 409, code: "already_joined" };

    expect(joinOutcome({ ok: false, failure })).toEqual({ type: "joined" });
  });

  it.each<[string, ApiFailure, boolean]>([
    ["story_full", { type: "rejected", status: 409, code: "story_full" }, false],
    ["stale_turn", { type: "rejected", status: 409, code: "stale_turn" }, true],
    ["a network failure", { type: "network" }, true],
    [
      "an unknown code that reads like story_full",
      { type: "unknown_code", status: 409, code: "story_full" },
      true,
    ],
    [
      "an unknown code that reads like already_joined",
      { type: "unknown_code", status: 409, code: "already_joined" },
      true,
    ],
    [
      "left_story",
      { type: "left_story", displayName: "Sam", opening: "Once.", openingAuthorId: "u1" },
      true,
    ],
  ])("fails on %s, with canRetry %s", (_name, failure, canRetry) => {
    expect(joinOutcome({ ok: false, failure })).toEqual({ type: "failed", failure, canRetry });
  });
});
