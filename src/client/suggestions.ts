import type { SuggestionsResponse } from "../shared/api";
import type { ApiResult } from "./api";
import { describeFailure } from "./messages";

export type SuggestionsState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "shown"; suggestions: readonly string[] }
  | { type: "failed"; message: string };

/** What to show for a finished request, and whether it showed the reader's turn is gone. */
export function suggestionsOutcome(result: ApiResult<SuggestionsResponse>): {
  state: SuggestionsState;
  turnLost: boolean;
} {
  if (result.ok) {
    return { state: { type: "shown", suggestions: result.value.suggestions }, turnLost: false };
  }

  const { failure } = result;

  return {
    state: { type: "failed", message: describeFailure(failure, FAILURE_MESSAGES) },
    turnLost: failure.type === "rejected" && failure.code === "not_your_turn",
  };
}

const FAILURE_MESSAGES = {
  ai_rate_limited:
    "You've used your suggestions for this hour. Try again later, or write your own passage.",
  ai_unavailable: "Suggestions aren't available right now. You can still write your own passage.",
  not_your_turn: "It's no longer your turn.",
};
