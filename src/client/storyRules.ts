import type { StoryView } from "../shared/api";
import { canSkip, onLeave, type TurnState } from "../shared/turnOrder";

/** The participant whose turn it is, or null while the story waits for a joiner. */
export function turnHolder(view: StoryView): StoryView["participants"][number] | null {
  return view.participants.find((participant) => participant.id === view.turn.holderId) ?? null;
}

export function isMyTurn(view: StoryView): boolean {
  return view.turn.holderId === view.me;
}

/**
 * Whether the server would accept a skip from this participant: they aren't the holder and the
 * shared `canSkip` rule finds someone to take the turn. The participants arrive in turn order,
 * so their indexes stand in for the stored positions.
 */
export function canSkipTurn(view: StoryView): boolean {
  const { holderId } = view.turn;
  if (holderId === null || holderId === view.me) {
    return false;
  }

  return canSkip(
    turnOrderState(
      view,
      view.participants.findIndex(({ id }) => id === holderId),
    ),
  );
}

/** The turn banner's headline: waiting, the viewer's turn, or the holder's. */
export function headline(view: StoryView, holderName: string | null): string {
  if (holderName === null) {
    return "Waiting for someone to join";
  }

  return isMyTurn(view) ? "It's your turn" : `It's ${holderName}'s turn`;
}

/** The skip button's label: in progress, or naming whose turn it would skip. */
export function skipLabel(skipping: boolean, holderName: string | null): string {
  return skipping ? "Skipping…" : `Skip ${holderName ?? "this turn"}`;
}

/** What leaving does to the turn. `unchanged` unless the one leaving holds it. */
export type TurnAfterLeaving =
  | { type: "unchanged" }
  | { type: "passes_to"; displayName: string }
  | { type: "waits" };

/**
 * What would happen to the turn if the viewer left, as the shared `onLeave` rule decides it. The
 * participants arrive in turn order, so their indexes stand in for the stored positions.
 */
export function turnAfterLeaving(view: StoryView): TurnAfterLeaving {
  if (!isMyTurn(view)) {
    return { type: "unchanged" };
  }

  const myPosition = view.participants.findIndex(({ id }) => id === view.me);
  const { currentPosition } = onLeave(turnOrderState(view, myPosition), myPosition, 0);
  if (currentPosition === null) {
    return { type: "waits" };
  }

  const next = view.participants[currentPosition];
  if (next === undefined) {
    throw new Error(`No participant at position ${currentPosition.toString()}`);
  }

  return { type: "passes_to", displayName: next.displayName };
}

// The view's turn as the shared rules take it. Only the order matters to them, so the clock is 0.
function turnOrderState(view: StoryView, currentPosition: number): TurnState {
  // A passage's author is a user, so the last writer is found by `userId`, not by participant `id`.
  const lastAuthorId = view.passages.at(-1)?.authorId;
  const lastWriterIndex = view.participants.findIndex(({ userId }) => userId === lastAuthorId);

  return {
    turnVersion: view.turn.version,
    lastContributorPosition: lastWriterIndex === -1 ? null : lastWriterIndex,
    participantPositions: view.participants.map((_, index) => index),
    currentPosition,
    turnStartedAt: 0,
  };
}
