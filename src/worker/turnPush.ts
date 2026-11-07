import { resolveTurn, turnEndsAt, turnPassedTo, type TurnState } from "../shared/turnOrder";
import {
  deletePushSubscriptionByEndpoint,
  loadPushSubscriptions,
  type PushSubscriptionRow,
} from "./db/pushRepo";
import type { ParticipantRow } from "./db/rows";
import { loadOpeningText, type Db, type LoadedStory } from "./db/storyRepo";
import type { AppContext } from "./http";
import type { PushMessage, PushSender } from "./push";
import { turnNotification } from "./turnNotification";

export interface TurnChange {
  storyId: string;
  /** The story as the request loaded it, before its write. */
  loaded: LoadedStory;
  /** The turn the request's write saved. */
  saved: TurnState;
  /**
   * The requester's position in `saved`'s turn order. It is not the position they held when they
   * loaded the story if they joined or rejoined: both take a new place at the end. The requester
   * is never pushed; they just acted and have the story open.
   */
  requesterPosition: number;
  now: number;
}

export interface HolderPush {
  storyId: string;
  /** The story's writers who have not left; the holder is one of them. */
  activeParticipants: readonly ParticipantRow[];
  holderPosition: number;
  /** The app's origin, so the notification opens the story on the host that sent it. */
  origin: string;
  now: number;
  turnEndsAt: number;
}

/**
 * Pushes "your turn" to the person a write handed the turn to, once the write has succeeded.
 * Nothing is sent when the same person keeps the turn, when the story goes to waiting or when the
 * requester is the new holder. The work runs under `waitUntil`: a slow push service can't delay a
 * write that is already committed, and no failure here reaches the response.
 *
 * The turn before the write is the stored one with expiry applied, so a holder whose window had
 * already lapsed does not count as having just received the turn from an unrelated change.
 */
export function notifyTurnHolder(
  c: AppContext,
  pushSender: (env: Env) => PushSender,
  change: TurnChange,
): void {
  const before = resolveTurn(change.loaded.state, change.now).state;
  const holderPosition = turnPassedTo(before, change.saved);
  const endsAt = turnEndsAt(change.saved);
  if (holderPosition === null || endsAt === null || holderPosition === change.requesterPosition) {
    return;
  }

  c.executionCtx.waitUntil(
    pushToHolder(c.env.DB, () => pushSender(c.env), {
      storyId: change.storyId,
      activeParticipants: change.loaded.activeParticipants,
      holderPosition,
      origin: new URL(c.req.url).origin,
      now: change.now,
      turnEndsAt: endsAt,
    }),
  );
}

/**
 * Sends "your turn" to every subscription of the user who is the writer at `holderPosition`. A
 * failure is logged and swallowed, never thrown.
 *
 * `buildSender` is called only once there is someone to send to, so an environment without VAPID
 * keys fails (logged) only for a user that subscribed.
 */
export async function pushToHolder(
  db: Db,
  buildSender: () => PushSender,
  { storyId, activeParticipants, holderPosition, origin, now, turnEndsAt: endsAt }: HolderPush,
): Promise<void> {
  try {
    const holder = activeParticipants.find((p) => p.position === holderPosition);
    if (holder === undefined) {
      throw new Error(`Story ${storyId} has no writer at position ${String(holderPosition)}`);
    }

    const subscriptions = await loadPushSubscriptions(db, holder.userId);
    if (subscriptions.length === 0) {
      return;
    }

    const sender = buildSender();
    const message = turnNotification({
      storyId,
      opening: await loadOpeningText(db, storyId),
      origin,
      now,
      turnEndsAt: endsAt,
    });
    await Promise.all(
      subscriptions.map((subscription) => sendAndForgetGone(db, sender, subscription, message)),
    );
  } catch (error) {
    console.error("Turn push failed", error);
  }
}

// One subscription's failure, even a failed delete, must not stop the holder's others.
async function sendAndForgetGone(
  db: Db,
  sender: PushSender,
  subscription: PushSubscriptionRow,
  message: PushMessage,
): Promise<void> {
  try {
    if ((await sender.send(subscription, message)) === "gone") {
      await deletePushSubscriptionByEndpoint(db, subscription.endpoint);
    }
  } catch (error) {
    console.error("Push to one subscription failed", error);
  }
}
