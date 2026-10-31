import type { StoryView } from "../shared/api";

/** The participant whose turn it is, or null while the story waits for a joiner. */
export function turnHolder(view: StoryView): StoryView["participants"][number] | null {
  return view.participants.find((participant) => participant.id === view.turn.holderId) ?? null;
}

export function isMyTurn(view: StoryView): boolean {
  return view.turn.holderId === view.me;
}

/**
 * Whether the server would accept a skip from this participant: they aren't the holder, the story
 * isn't waiting, and someone other than the holder and the last writer can take the turn. With
 * only two people that someone doesn't exist (`no_one_to_skip_to`), because the turn passes over
 * the last writer and would come straight back to the holder.
 *
 * Mirrors `skip` in `src/shared/turnOrder.ts`; the server stays the authority.
 */
export function canSkipTurn(view: StoryView): boolean {
  const { holderId } = view.turn;
  if (holderId === null || holderId === view.me) {
    return false;
  }

  const lastWriterId = view.contributions.at(-1)?.authorId;

  return view.participants.some(
    (participant) => participant.id !== holderId && participant.id !== lastWriterId,
  );
}
