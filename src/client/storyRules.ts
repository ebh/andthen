import type { StoryView } from "../shared/api";
import { canSkip } from "../shared/turnOrder";

/** The participant whose turn it is, or null while the story waits for a joiner. */
export function turnHolder(view: StoryView): StoryView["participants"][number] | null {
  return view.participants.find((participant) => participant.id === view.turn.holderId) ?? null;
}

export function isMyTurn(view: StoryView): boolean {
  return view.turn.holderId === view.me;
}

/**
 * Whether the server would accept a skip from this participant: they aren't the holder and the
 * shared `canSkip` rule finds someone to take the turn. The participants arrive in rotation
 * order, so their indexes stand in for the stored positions.
 */
export function canSkipTurn(view: StoryView): boolean {
  const { holderId } = view.turn;
  if (holderId === null || holderId === view.me) {
    return false;
  }

  const lastWriterId = view.contributions.at(-1)?.authorId;
  const lastWriterIndex = view.participants.findIndex(({ id }) => id === lastWriterId);

  return canSkip({
    turnVersion: view.turn.version,
    lastContributorPosition: lastWriterIndex === -1 ? null : lastWriterIndex,
    participantPositions: view.participants.map((_, index) => index),
    currentPosition: view.participants.findIndex(({ id }) => id === holderId),
    turnStartedAt: 0,
  });
}
