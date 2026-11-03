import type { StorySummary } from "../shared/api";
import { resolveTurn, turnEndsAt } from "../shared/turnOrder";
import { toTurnState, type MyStoryRows } from "./db/storyRepo";
import type { MyStoryRow } from "./db/rows";

interface DatedSummary {
  summary: StorySummary;
  /** When the story's newest passage was written. */
  latestAt: number;
}

/**
 * The stories a browser is in, for its list. Each turn comes from `resolveTurn(state, now)`, not
 * the stored row, as in the story view. The story the browser holds the turn in comes first,
 * then the story with the newest passage.
 */
export function summariseMyStories(rows: MyStoryRows, now: number): StorySummary[] {
  return rows.stories
    .map((story) => summarise(story, rows, now))
    .toSorted(
      (a, b) =>
        Number(b.summary.isMyTurn) - Number(a.summary.isMyTurn) ||
        b.latestAt - a.latestAt ||
        a.summary.id.localeCompare(b.summary.id),
    )
    .map(({ summary }) => summary);
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
