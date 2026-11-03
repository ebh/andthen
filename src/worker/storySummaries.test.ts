import { describe, expect, it } from "vitest";

import { TURN_WINDOW_MS } from "../shared/validation";
import type { MyStoryRow, StoryPassageRow, StoryWriterRow } from "./db/rows";
import type { MyStoryRows } from "./db/storyRepo";
import { summariseMyStories } from "./storySummaries";

const T0 = 1_700_000_000_000;

function running(id: string, currentPosition: number, myPosition = 0): MyStoryRow {
  return {
    id,
    createdAt: T0,
    turnVersion: 2,
    lastContributorPosition: 0,
    currentPosition,
    turnStartedAt: T0,
    myPosition,
  };
}

function waitingStory(id: string): MyStoryRow {
  return {
    id,
    createdAt: T0,
    turnVersion: 0,
    lastContributorPosition: 0,
    currentPosition: null,
    turnStartedAt: null,
    myPosition: 0,
  };
}

function writers(storyId: string, ...names: string[]): StoryWriterRow[] {
  return names.map((displayName, position) => ({ storyId, displayName, position }));
}

function passage(storyId: string, opening: string, latestAt = T0): StoryPassageRow {
  return { storyId, opening, latestAt };
}

describe("summariseMyStories", () => {
  it("names the holder, the end of the turn, the opening and the writers", () => {
    const rows: MyStoryRows = {
      stories: [running("abc12", 1)],
      writers: writers("abc12", "Ana", "Ben", "Cal"),
      passages: [passage("abc12", "Once upon a time.")],
    };

    expect(summariseMyStories(rows, T0 + 5)).toEqual([
      {
        id: "abc12",
        opening: "Once upon a time.",
        holderName: "Ben",
        isMyTurn: false,
        endsAt: T0 + TURN_WINDOW_MS,
        writerCount: 3,
      },
    ]);
  });

  it("marks the story whose turn it is the caller's", () => {
    const rows: MyStoryRows = {
      stories: [running("abc12", 1, 1)],
      writers: writers("abc12", "Ana", "Ben"),
      passages: [passage("abc12", "Once.")],
    };

    expect(summariseMyStories(rows, T0)[0]).toMatchObject({ holderName: "Ben", isMyTurn: true });
  });

  it("shows a waiting story with no holder and no end time", () => {
    const rows: MyStoryRows = {
      stories: [waitingStory("abc12")],
      writers: writers("abc12", "Ana"),
      passages: [passage("abc12", "Once.")],
    };

    expect(summariseMyStories(rows, T0)).toEqual([
      {
        id: "abc12",
        opening: "Once.",
        holderName: null,
        isMyTurn: false,
        endsAt: null,
        writerCount: 1,
      },
    ]);
  });

  it("applies expiry, so an expired turn shows its new holder", () => {
    const rows: MyStoryRows = {
      stories: [running("abc12", 1)],
      writers: writers("abc12", "Ana", "Ben", "Cal"),
      passages: [passage("abc12", "Once.")],
    };

    expect(summariseMyStories(rows, T0 + TURN_WINDOW_MS)[0]).toMatchObject({
      holderName: "Cal",
      endsAt: T0 + 2 * TURN_WINDOW_MS,
    });
  });

  it("counts only each story's own writers", () => {
    const rows: MyStoryRows = {
      stories: [waitingStory("aaaaa"), running("bbbbb", 1)],
      writers: [...writers("aaaaa", "Ana"), ...writers("bbbbb", "Ana", "Ben")],
      passages: [passage("aaaaa", "One."), passage("bbbbb", "Two.")],
    };

    const counts = summariseMyStories(rows, T0).map(({ id, writerCount }) => [id, writerCount]);

    expect(counts).toEqual(
      expect.arrayContaining([
        ["aaaaa", 1],
        ["bbbbb", 2],
      ]),
    );
  });

  it("lists the story the caller holds the turn in first, then the newest passage first", () => {
    const rows: MyStoryRows = {
      stories: [running("older", 1), running("newer", 1), running("mine", 1, 1)],
      writers: [
        ...writers("older", "Ana", "Ben"),
        ...writers("newer", "Ana", "Ben"),
        ...writers("mine", "Ana", "Ben"),
      ],
      passages: [
        passage("older", "A.", T0 + 1),
        passage("newer", "B.", T0 + 3),
        passage("mine", "C.", T0),
      ],
    };

    expect(summariseMyStories(rows, T0).map(({ id }) => id)).toEqual(["mine", "newer", "older"]);
  });

  it("breaks a tie by story ID so the order never changes between requests", () => {
    const rows: MyStoryRows = {
      stories: [waitingStory("bbbbb"), waitingStory("aaaaa")],
      writers: [...writers("bbbbb", "Ana"), ...writers("aaaaa", "Ana")],
      passages: [passage("bbbbb", "B."), passage("aaaaa", "A.")],
    };

    expect(summariseMyStories(rows, T0).map(({ id }) => id)).toEqual(["aaaaa", "bbbbb"]);
  });

  it("fails fast when a story has no passages", () => {
    const rows: MyStoryRows = {
      stories: [waitingStory("abc12")],
      writers: writers("abc12", "Ana"),
      passages: [],
    };

    expect(() => summariseMyStories(rows, T0)).toThrow("Story abc12 has no passages");
  });

  it("fails fast when the stored holder is not a writer", () => {
    const rows: MyStoryRows = {
      stories: [running("abc12", 7)],
      writers: writers("abc12", "Ana"),
      passages: [passage("abc12", "Once.")],
    };

    expect(() => summariseMyStories(rows, T0)).toThrow(
      "Story abc12 has no participant at position 7",
    );
  });
});
