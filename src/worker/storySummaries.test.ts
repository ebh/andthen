import { describe, expect, it } from "vitest";

import { TURN_WINDOW_MS } from "../shared/validation";
import type { MyStoryRow, StoryPassageRow, StoryWriterRow } from "./db/rows";
import type { MyStoryRows } from "./db/typeSchemas";
import { decodeStoryCursor } from "./storyCursor";
import { summariseMyStories, type StoriesPage } from "./storySummaries";

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

function passage(
  storyId: string,
  opening: string,
  latestAt = T0,
  openingAuthorId = "u-author",
): StoryPassageRow {
  return { storyId, opening, openingAuthorId, latestAt };
}

// Every story on one page, in list order.
function summaries(rows: MyStoryRows, now: number) {
  return summariseMyStories(rows, now, { limit: 1000, after: null }).stories;
}

// Five stories in list order: mine1, mine2 (the caller's turn), then new, mid, old.
function fiveStories(): MyStoryRows {
  const storyIds = ["mine1", "mine2", "newer", "mid01", "old01"];

  return {
    stories: [
      running("old01", 1),
      running("mine2", 1, 1),
      running("mid01", 1),
      running("newer", 1),
      running("mine1", 1, 1),
    ],
    writers: storyIds.flatMap((id) => writers(id, "Ana", "Ben")),
    passages: [
      passage("mine1", "A.", T0 + 10),
      passage("mine2", "B.", T0 + 10),
      passage("newer", "C.", T0 + 9),
      passage("mid01", "D.", T0 + 5),
      passage("old01", "E.", T0 + 1),
    ],
  };
}

function ids(page: ReturnType<typeof summariseMyStories>): string[] {
  return page.stories.map(({ id }) => id);
}

function after(cursor: string | null): StoriesPage["after"] {
  if (cursor === null) {
    throw new Error("Expected a next cursor");
  }

  return decodeStoryCursor(cursor);
}

describe("summariseMyStories", () => {
  it("names the holder, the end of the turn, the opening and the writers", () => {
    const rows: MyStoryRows = {
      stories: [running("abc12", 1)],
      writers: writers("abc12", "Ana", "Ben", "Cal"),
      passages: [passage("abc12", "Once upon a time.")],
    };

    expect(summaries(rows, T0 + 5)).toEqual([
      {
        id: "abc12",
        opening: "Once upon a time.",
        openingAuthorId: "u-author",
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

    expect(summaries(rows, T0)[0]).toMatchObject({ holderName: "Ben", isMyTurn: true });
  });

  it("shows a waiting story with no holder and no end time", () => {
    const rows: MyStoryRows = {
      stories: [waitingStory("abc12")],
      writers: writers("abc12", "Ana"),
      passages: [passage("abc12", "Once.")],
    };

    expect(summaries(rows, T0)).toEqual([
      {
        id: "abc12",
        opening: "Once.",
        openingAuthorId: "u-author",
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

    expect(summaries(rows, T0 + TURN_WINDOW_MS)[0]).toMatchObject({
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

    const counts = summaries(rows, T0).map(({ id, writerCount }) => [id, writerCount]);

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

    expect(summaries(rows, T0).map(({ id }) => id)).toEqual(["mine", "newer", "older"]);
  });

  it("breaks a tie by story ID so the order never changes between requests", () => {
    const rows: MyStoryRows = {
      stories: [waitingStory("bbbbb"), waitingStory("aaaaa")],
      writers: [...writers("bbbbb", "Ana"), ...writers("aaaaa", "Ana")],
      passages: [passage("bbbbb", "B."), passage("aaaaa", "A.")],
    };

    expect(summaries(rows, T0).map(({ id }) => id)).toEqual(["aaaaa", "bbbbb"]);
  });

  it("fails fast when a story has no passages", () => {
    const rows: MyStoryRows = {
      stories: [waitingStory("abc12")],
      writers: writers("abc12", "Ana"),
      passages: [],
    };

    expect(() => summaries(rows, T0)).toThrow("Story abc12 has no passages");
  });

  it("fails fast when the stored holder is not a writer", () => {
    const rows: MyStoryRows = {
      stories: [running("abc12", 7)],
      writers: writers("abc12", "Ana"),
      passages: [passage("abc12", "Once.")],
    };

    expect(() => summaries(rows, T0)).toThrow("Story abc12 has no participant at position 7");
  });

  describe("paging", () => {
    it("cuts the first page at the limit and gives a cursor for the rest", () => {
      const page = summariseMyStories(fiveStories(), T0, { limit: 2, after: null });

      expect(ids(page)).toEqual(["mine1", "mine2"]);
      expect(decodeStoryCursor(page.nextCursor ?? "")).toEqual({
        isMyTurn: true,
        latestAt: T0 + 10,
        id: "mine2",
      });
    });

    it("walks the whole list page by page with no repeat and no gap", () => {
      const rows = fiveStories();
      const seen: string[] = [];

      let cursor: string | null = null;
      do {
        const page = summariseMyStories(rows, T0, {
          limit: 2,
          after: cursor === null ? null : after(cursor),
        });
        seen.push(...ids(page));
        cursor = page.nextCursor;
      } while (cursor !== null);

      expect(seen).toEqual(["mine1", "mine2", "newer", "mid01", "old01"]);
    });

    it("gives no cursor when the page ends exactly at the end of the list", () => {
      const page = summariseMyStories(fiveStories(), T0, { limit: 5, after: null });

      expect(ids(page)).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
    });

    it("gives a cursor when one story is left over", () => {
      const page = summariseMyStories(fiveStories(), T0, { limit: 4, after: null });

      expect(page.nextCursor).not.toBeNull();
    });

    it("continues after a cursor whose story has left the list", () => {
      const rows = fiveStories();
      const first = summariseMyStories(rows, T0, { limit: 3, after: null });
      const withoutNewer: MyStoryRows = {
        ...rows,
        stories: rows.stories.filter(({ id }) => id !== "newer"),
      };

      const next = summariseMyStories(withoutNewer, T0, {
        limit: 3,
        after: after(first.nextCursor),
      });

      expect(ids(next)).toEqual(["mid01", "old01"]);
    });

    it("gives an empty last page after the final story", () => {
      const page = summariseMyStories(fiveStories(), T0, {
        limit: 3,
        after: { isMyTurn: false, latestAt: T0 + 1, id: "old01" },
      });

      expect(page).toEqual({ stories: [], nextCursor: null });
    });
  });
});
