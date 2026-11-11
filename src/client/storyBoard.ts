import type { ApiFailure } from "./api";

// Each of these means the page's picture of the story is out of date. `not_participant` sends
// the refetch to a 403, which swaps the page for the join form.
export const REFETCH_CODES = new Set(["stale_turn", "not_your_turn", "not_participant"]);

// `left_story` is the same, with the refetch swapping the page for the rejoin screen.
export function isStoryOutOfDate(failure: ApiFailure): boolean {
  return (
    failure.type === "left_story" ||
    (failure.type === "rejected" && REFETCH_CODES.has(failure.code))
  );
}

export const CONTRIBUTE_MESSAGES = {
  stale_turn:
    "The story changed while you were writing. Your text is kept. Check whose turn it is, then send again.",
  not_your_turn: "It's no longer your turn. Your text is kept in case the turn comes back to you.",
  not_participant: "You're not part of this story. Join it to write.",
  invalid_passage: "That passage can't be sent. Check that it isn't empty or too long.",
};

export const LEAVE_MESSAGES = {
  stale_turn: "The story changed just now. Check who has the turn, then try again.",
  not_participant: "You're not part of this story.",
};

export const SKIP_MESSAGES = {
  stale_turn: "The turn had already moved on, so nothing was skipped.",
  no_one_to_skip_to: "There's no one else to take the turn.",
  not_participant: "You're not part of this story. Join it to write.",
  cannot_skip_self: "You can't skip your own turn.",
};
