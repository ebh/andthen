import type { ApiFailure, ApiResult } from "./api";
import { describeFailure } from "./messages";

/**
 * A failed send says whether to reload the story and what to tell the writer. The caller keeps
 * the draft on a failure: after a 409 or 403 the turn may come back, and the text took effort.
 */
export type SendOutcome = { type: "sent" } | { type: "failed"; refetch: boolean; notice: string };

/** The board always reloads the story after a skip, so a skip carries only a notice. */
export interface SkipOutcome {
  notice: string | null;
}

/**
 * A failed leave says whether to reload the story. The dialog says who gets the turn; the story
 * it was worked out from may have moved on.
 */
export type LeaveOutcome = { type: "left" } | { type: "failed"; refetch: boolean; error: string };

export interface DraftState {
  draft: string;
  /** The draft a suggestion replaced, until the next edit. */
  replacedDraft: string | null;
}

export function sendOutcome(result: ApiResult<unknown>): SendOutcome {
  if (result.ok) {
    return { type: "sent" };
  }

  return {
    type: "failed",
    refetch: isStoryOutOfDate(result.failure),
    notice: describeFailure(result.failure, CONTRIBUTE_MESSAGES),
  };
}

export function skipOutcome(result: ApiResult<unknown>): SkipOutcome {
  if (result.ok) {
    return { notice: null };
  }

  return { notice: describeFailure(result.failure, SKIP_MESSAGES) };
}

export function leaveOutcome(result: ApiResult<unknown>): LeaveOutcome {
  if (result.ok) {
    return { type: "left" };
  }

  return {
    type: "failed",
    refetch: isStoryOutOfDate(result.failure),
    error: describeFailure(result.failure, LEAVE_MESSAGES),
  };
}

export function editDraft(text: string): DraftState {
  return { draft: text, replacedDraft: null };
}

export function applySuggestion(state: DraftState, text: string): DraftState {
  const replaced = state.draft.trim() === "" || state.draft === text ? null : state.draft;

  return { draft: text, replacedDraft: replaced };
}

export function undoSuggestion(state: DraftState): DraftState {
  return { draft: state.replacedDraft ?? state.draft, replacedDraft: null };
}

// Each of these means the page's picture of the story is out of date. `not_participant` sends
// the refetch to a 403, which swaps the page for the join form.
const REFETCH_CODES = new Set(["stale_turn", "not_your_turn", "not_participant"]);

// `left_story` is the same, with the refetch swapping the page for the rejoin screen.
export function isStoryOutOfDate(failure: ApiFailure): boolean {
  return (
    failure.type === "left_story" ||
    (failure.type === "rejected" && REFETCH_CODES.has(failure.code))
  );
}

const CONTRIBUTE_MESSAGES = {
  stale_turn:
    "The story changed while you were writing. Your text is kept. Check whose turn it is, then send again.",
  not_your_turn: "It's no longer your turn. Your text is kept in case the turn comes back to you.",
  not_participant: "You're not part of this story. Join it to write.",
  invalid_passage: "That passage can't be sent. Check that it isn't empty or too long.",
};

const LEAVE_MESSAGES = {
  stale_turn: "The story changed just now. Check who has the turn, then try again.",
  not_participant: "You're not part of this story.",
};

const SKIP_MESSAGES = {
  stale_turn: "The turn had already moved on, so nothing was skipped.",
  no_one_to_skip_to: "There's no one else to take the turn.",
  not_participant: "You're not part of this story. Join it to write.",
  cannot_skip_self: "You can't skip your own turn.",
};
