import type { ApiFailure } from "./api";
import type { BlocksStatus } from "./blocks";

export type BlockAction = "block" | "unblock";

/** Two lines that share one row. At most one is non-empty, and both are empty when all is well. */
export interface BlocksNotice {
  /** Progress, such as "Blocking…". */
  progress: string;
  /** A failure of the last change, or of the list load. */
  failure: string;
}

/** Shown while the user's blocks are unknown, so passages by others stay obscured. */
export const BLOCKS_LOAD_FAILED = "Couldn't load blocked users. Try again.";

/**
 * The line for the whole page: progress first, then the last change's failure, then a failed list
 * load. The page always renders both lines, empty when there is nothing to say, so a screen reader
 * announces the text that arrives and the story text never moves.
 */
export function blocksNotice(blocks: {
  status: BlocksStatus;
  working: string | null;
  error: string | null;
}): BlocksNotice {
  if (blocks.working !== null) {
    return { progress: blocks.working, failure: "" };
  }

  return {
    progress: "",
    failure: blocks.error ?? (blocks.status === "failed" ? BLOCKS_LOAD_FAILED : ""),
  };
}

/** The accessible name of an opening's stand-in. It cannot be pressed, so it is an image. */
export const OPENING_HIDDEN_LABEL = "Opening passage, hidden because you blocked its author";

/** The accessible name of a passage's stand-in: it says what is hidden and why, never the text. */
export function hiddenPassageLabel(authorName: string): string {
  return `Passage by ${authorName}, hidden because you blocked them`;
}

/** The line shown while a Block or Unblock request is out. */
export function describeBlockProgress(action: BlockAction): string {
  return action === "block" ? "Blocking…" : "Unblocking…";
}

/**
 * The line shown when a Block or Unblock failed. It names the action but never the user: a display
 * name can be 40 characters, and the line must fit one row on a 375px phone so the story text
 * below never moves when it appears. That is why these skip the shared wording.
 */
export function describeBlockFailure(action: BlockAction, failure: ApiFailure): string {
  return `Couldn't ${action}. ${reason(failure)}`;
}

function reason(failure: ApiFailure): string {
  if (failure.type === "network") {
    return "Check your connection.";
  }
  if (failure.type === "client_outdated") {
    return "Reload the page.";
  }
  if (failure.type === "rejected") {
    switch (failure.code) {
      case "cannot_block_self":
        return "That's you.";
      case "not_found":
        return "Reload the page.";
    }
  }

  return "Try again.";
}
