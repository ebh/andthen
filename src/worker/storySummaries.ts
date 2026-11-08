import type { StorySummary } from "../shared/api";
import { resolveTurn, turnEndsAt } from "../shared/turnOrder";
import { toTurnState, type MyStoryRows } from "./db/storyRepo";
import type { MyStoryRow } from "./db/rows";
import { encodeStoryCursor, type StoryCursor } from "./storyCursor";

export interface StoriesPage {
  limit: number;
  /** The last story of the previous page; null for the first page. */
  after: StoryCursor | null;
}

interface DatedSummary {
  summary: StorySummary;
  /** When the story's newest passage was written. */
  latestAt: number;
}

/**
 * One page of the stories a browser is in, for its list. Each turn comes from
 * `resolveTurn(state, now)`, not the stored row, as in the story view. The story the browser holds
 * the turn in comes first, then the story with the newest passage. A page is cut from the whole
 * sorted list, so a story can be skipped or repeated when turns or passages change between pages.
 */
export function summariseMyStories(
  rows: MyStoryRows,
  now: number,
  page: StoriesPage,
): { stories: StorySummary[]; nextCursor: string | null } {
  const { after } = page;
  const sorted = rows.stories
    .map((story) => summarise(story, rows, now))
    .toSorted((a, b) => compareListOrder(listKey(a), listKey(b)));
  const remaining =
    after === null ? sorted : sorted.filter((story) => compareListOrder(listKey(story), after) > 0);
  const onPage = remaining.slice(0, page.limit);
  const last = onPage.at(-1);

  return {
    stories: onPage.map(({ summary }) => summary),
    nextCursor:
      last !== undefined && remaining.length > onPage.length
        ? encodeStoryCursor(listKey(last))
        : null,
  };
}

function summarise(story: MyStoryRow, rows: MyStoryRows, now: number): DatedSummary {
  const writers = rows.writers.filter((writer) => writer.storyId === story.id);
  const passage = rows.passages.find((candidate) => candidate.storyId === story.id);
  if (passage === undefined) {
    throw new Error(`Story ${story.id} has no passages`);
  }

  const { state } = resolveTurn(
    toTurnState(
      story,
      writers.map((writer) => writer.position),
    ),
    now,
  );
  const holder = writers.find((writer) => writer.position === state.currentPosition);
  if (state.currentPosition !== null && holder === undefined) {
    throw new Error(
      `Story ${story.id} has no participant at position ${String(state.currentPosition)}`,
    );
  }

  return {
    summary: {
      id: story.id,
      opening: passage.opening,
      holderName: holder?.displayName ?? null,
      isMyTurn: state.currentPosition === story.myPosition,
      endsAt: turnEndsAt(state),
      writerCount: writers.length,
    },
    latestAt: passage.latestAt,
  };
}

function listKey({ summary, latestAt }: DatedSummary): StoryCursor {
  return { isMyTurn: summary.isMyTurn, latestAt, id: summary.id };
}

// Negative when `a` is listed before `b`.
function compareListOrder(a: StoryCursor, b: StoryCursor): number {
  return (
    Number(b.isMyTurn) - Number(a.isMyTurn) || b.latestAt - a.latestAt || a.id.localeCompare(b.id)
  );
}
