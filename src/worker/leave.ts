import { onLeave } from "../shared/turnOrder";
import type { ParticipantRow } from "./db/rows";
import { leaveStory, type LoadedStory } from "./db/storyRepo";
import type { AppContext } from "./http";
import { notifyRoom } from "./live";
import type { PushSender } from "./push";
import { notifyTurnHolder } from "./turnPush";

export interface LeaveDeps {
  /** The clock, in epoch milliseconds. */
  now: () => number;
  /** The sender for this request's bindings; throws when the VAPID keys are missing or invalid. */
  pushSender: (env: Env) => PushSender;
}

/**
 * Takes `participant` out of the story as `loaded` found it: marks them left, passes the turn on
 * as a leave does, then tells the story's open sockets and the new turn holder. False when the
 * story moved on since it was loaded; nothing is written then, so the caller can reload and retry.
 */
export async function leaveAsParticipant(
  c: AppContext,
  deps: LeaveDeps,
  loaded: LoadedStory,
  participant: ParticipantRow,
): Promise<boolean> {
  const storyId = loaded.story.id;
  const now = deps.now();
  const next = onLeave(loaded.state, participant.position, now);

  const saved = await leaveStory(c.env.DB, {
    storyId,
    loadedVersion: loaded.state.turnVersion,
    next,
    participantId: participant.id,
    leftAt: now,
  });
  if (!saved) {
    return false;
  }

  notifyRoom(c, storyId, next);
  notifyTurnHolder(c, deps.pushSender, {
    storyId,
    loaded,
    saved: next,
    requesterPosition: participant.position,
    now,
  });

  return true;
}
