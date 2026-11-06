import { resolveTurn, turnEndsAt, turnPassedTo } from "../shared/turnOrder";
import { loadStory, saveTurn, type Db } from "./db/storyRepo";
import type { PushSender } from "./push";
import { pushToHolder } from "./turnPush";

export interface TurnTimeoutInput {
  storyId: string;
  /** The app's origin, so the push opens the story on the host that served it. */
  origin: string;
  now: number;
}

/** What the story's room does once a timeout has been dealt with. */
export interface TurnTimeoutOutcome {
  /** The turn version to tell the open sockets, or null when this call saved nothing. */
  newTurnVersion: number | null;
  /** When to wake the room next, or null when the story has no running turn. */
  nextDeadline: number | null;
}

/**
 * Applies a turn window that ran out: saves the turn that expiry produces and pushes "your turn"
 * to the writer it lands on. Safe to call at any time and any number of times. It re-reads the
 * story and decides from `now`, so a duplicate call, an early call, a call on a waiting story or
 * one that loses a race with a write changes nothing, and only a call that saves pushes.
 *
 * A push failure is logged, not thrown. Any other failure throws, so the caller can retry.
 */
export async function passTimedOutTurn(
  db: Db,
  buildSender: () => PushSender,
  { storyId, origin, now }: TurnTimeoutInput,
): Promise<TurnTimeoutOutcome> {
  const loaded = await loadStory(db, storyId);
  if (loaded === null) {
    return { newTurnVersion: null, nextDeadline: null };
  }

  const resolved = resolveTurn(loaded.state, now);
  if (!resolved.changed) {
    return { newTurnVersion: null, nextDeadline: turnEndsAt(loaded.state) };
  }

  const saved = await saveTurn(db, storyId, loaded.state.turnVersion, resolved.state);
  if (!saved) {
    // A write got in first. It notifies the room itself; this reports the deadline it left.
    return { newTurnVersion: null, nextDeadline: await storedDeadline(db, storyId) };
  }

  const nextDeadline = turnEndsAt(resolved.state);
  const holderPosition = turnPassedTo(loaded.state, resolved.state);
  if (holderPosition !== null && nextDeadline !== null) {
    await pushToHolder(db, buildSender, {
      storyId,
      activeParticipants: loaded.activeParticipants,
      holderPosition,
      origin,
      now,
      turnEndsAt: nextDeadline,
    });
  }

  return { newTurnVersion: resolved.state.turnVersion, nextDeadline };
}

async function storedDeadline(db: Db, storyId: string): Promise<number | null> {
  const current = await loadStory(db, storyId);

  return current === null ? null : turnEndsAt(current.state);
}
