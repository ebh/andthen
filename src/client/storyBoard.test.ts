import { describe, expect, it } from "vitest";

import type { ApiFailure } from "./api";
import { isStoryOutOfDate, leaveOutcome, sendOutcome, skipOutcome } from "./storyBoard";

const GENERIC = "Something went wrong. Please try again.";
const OFFLINE = "Can't reach the server. Check your connection and try again.";

function rejected(code: Extract<ApiFailure, { type: "rejected" }>["code"]): ApiFailure {
  return { type: "rejected", status: 409, code };
}

describe("isStoryOutOfDate", () => {
  it.each<[string, ApiFailure, boolean]>([
    ["a rejected stale_turn", rejected("stale_turn"), true],
    ["a rejected not_your_turn", rejected("not_your_turn"), true],
    ["a rejected not_participant", rejected("not_participant"), true],
    ["left_story", { type: "left_story", displayName: "Sam", opening: "Once." }, true],
    ["a rejected invalid_passage", rejected("invalid_passage"), false],
    ["a rejected code outside the refetch codes", rejected("story_full"), false],
    ["a network failure", { type: "network" }, false],
    [
      "an unknown code that reads like stale_turn",
      { type: "unknown_code", status: 409, code: "stale_turn" },
      false,
    ],
  ])("is %s: %s", (_name, failure, outOfDate) => {
    expect(isStoryOutOfDate(failure)).toBe(outOfDate);
  });
});

describe("sendOutcome", () => {
  it("treats an ok result as sent", () => {
    expect(sendOutcome({ ok: true, value: {} })).toEqual({ type: "sent" });
  });

  it.each<[string, ApiFailure, boolean, string]>([
    [
      "stale_turn",
      rejected("stale_turn"),
      true,
      "The story changed while you were writing. Your text is kept. Check whose turn it is, then send again.",
    ],
    [
      "not_your_turn",
      rejected("not_your_turn"),
      true,
      "It's no longer your turn. Your text is kept in case the turn comes back to you.",
    ],
    [
      "not_participant",
      rejected("not_participant"),
      true,
      "You're not part of this story. Join it to write.",
    ],
    [
      "invalid_passage",
      rejected("invalid_passage"),
      false,
      "That passage can't be sent. Check that it isn't empty or too long.",
    ],
    ["a rejected code with no message of its own", rejected("story_full"), false, GENERIC],
    ["a network failure", { type: "network" }, false, OFFLINE],
    ["an unknown code", { type: "unknown_code", status: 409, code: "stale_turn" }, false, GENERIC],
    ["left_story", { type: "left_story", displayName: "Sam", opening: "Once." }, true, GENERIC],
  ])("fails on %s", (_name, failure, refetch, notice) => {
    expect(sendOutcome({ ok: false, failure })).toEqual({ type: "failed", refetch, notice });
  });
});

describe("skipOutcome", () => {
  it("has no notice when the skip worked", () => {
    expect(skipOutcome({ ok: true, value: undefined })).toEqual({ notice: null });
  });

  it.each<[string, ApiFailure, string]>([
    [
      "stale_turn",
      rejected("stale_turn"),
      "The turn had already moved on, so nothing was skipped.",
    ],
    ["no_one_to_skip_to", rejected("no_one_to_skip_to"), "There's no one else to take the turn."],
    [
      "not_participant",
      rejected("not_participant"),
      "You're not part of this story. Join it to write.",
    ],
    ["cannot_skip_self", rejected("cannot_skip_self"), "You can't skip your own turn."],
    ["a rejected code with no message of its own", rejected("story_full"), GENERIC],
    ["a network failure", { type: "network" }, OFFLINE],
  ])("explains %s", (_name, failure, notice) => {
    expect(skipOutcome({ ok: false, failure })).toEqual({ notice });
  });
});

describe("leaveOutcome", () => {
  it("treats an ok result as left", () => {
    expect(leaveOutcome({ ok: true, value: undefined })).toEqual({ type: "left" });
  });

  it.each<[string, ApiFailure, boolean, string]>([
    [
      "stale_turn",
      rejected("stale_turn"),
      true,
      "The story changed just now. Check who has the turn, then try again.",
    ],
    ["not_participant", rejected("not_participant"), true, "You're not part of this story."],
    ["a rejected code with no message of its own", rejected("story_full"), false, GENERIC],
    ["a network failure", { type: "network" }, false, OFFLINE],
    ["left_story", { type: "left_story", displayName: "Sam", opening: "Once." }, true, GENERIC],
  ])("fails on %s", (_name, failure, refetch, error) => {
    expect(leaveOutcome({ ok: false, failure })).toEqual({ type: "failed", refetch, error });
  });
});
