import type { ApiFailure, ApiResult } from "./api";

export type JoinOutcome =
  | { type: "joined" }
  | { type: "failed"; failure: ApiFailure; canRetry: boolean };

/**
 * ok and `already_joined` (another tab got there first) both mean joined. A full story stays
 * full, so `story_full` can't be retried: retrying would only fail again.
 */
export function joinOutcome(result: ApiResult<unknown>): JoinOutcome {
  if (result.ok) {
    return { type: "joined" };
  }

  const { failure } = result;
  if (failure.type === "rejected" && failure.code === "already_joined") {
    return { type: "joined" };
  }

  const isFull = failure.type === "rejected" && failure.code === "story_full";

  return { type: "failed", failure, canRetry: !isFull };
}
