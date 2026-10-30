import type { StoryView, TurnView } from "../shared/api";
import { resolveTurn, turnEndsAt } from "../shared/turnOrder";
import type { LoadedStory } from "./db/storyRepo";
import type { ContributionRow, ParticipantRow } from "./db/rows";

/**
 * What a participant sees. The turn comes from `resolveTurn(state, now)`, not the stored row:
 * the row still names the old holder and a past end time once a turn has expired.
 */
export function buildStoryView(
  loaded: LoadedStory,
  contributions: ContributionRow[],
  me: ParticipantRow,
  now: number,
): StoryView {
  return {
    contributions,
    participants: loaded.participants.map(({ id, displayName }) => ({ id, displayName })),
    turn: buildTurnView(loaded, now),
    me: me.id,
  };
}

function buildTurnView(loaded: LoadedStory, now: number): TurnView {
  const { state } = resolveTurn(loaded.state, now);
  const endsAt = turnEndsAt(state);

  if (endsAt === null) {
    return { holderId: null, endsAt: null, version: state.turnVersion };
  }

  const holder = loaded.participants.find(({ position }) => position === state.currentPosition);
  if (holder === undefined) {
    throw new Error(
      `Story ${loaded.story.id} has no participant at position ${String(state.currentPosition)}`,
    );
  }

  return { holderId: holder.id, endsAt, version: state.turnVersion };
}
