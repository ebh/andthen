import type { StoryView } from "../shared/api";
import { canSkip, onLeave, type TurnState } from "../shared/turnOrder";

/** What an author's menu offers about blocking them. */
export type BlockOffer =
  | { type: "none" }
  | { type: "block"; label: string }
  | { type: "unblock"; label: string };

/** What leaving does to the turn. `unchanged` unless the one leaving holds it. */
export type TurnAfterLeaving =
  | { type: "unchanged" }
  | { type: "passes_to"; displayName: string }
  | { type: "waits" };

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

/**
 * The user ID of the viewer, who is a participant of the view. A passage names its author by user,
 * so this is what tells the viewer's own passages from the rest.
 */
export function myUserId(view: Pick<StoryView, "me" | "participants">): string {
  const myParticipant = view.participants.find(({ id }) => id === view.me);
  if (myParticipant === undefined) {
    throw new Error(`No participant for ${view.me}`);
  }

  return myParticipant.userId;
}

/**
 * The block action an author's menu offers the user. The user never blocks their own name, and a
 * non-null `blockId` means they already block that author, so the offer lifts it.
 */
export function blockOffer(author: {
  authorId: string;
  authorName: string;
  myUserId: string;
  blockId: string | null;
}): BlockOffer {
  if (author.authorId === author.myUserId) {
    return { type: "none" };
  }
  if (author.blockId !== null) {
    return { type: "unblock", label: `Unblock ${author.authorName}` };
  }

  return { type: "block", label: `Block ${author.authorName}` };
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
