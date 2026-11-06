import { resolveTurn, turnEndsAt, turnPassedTo, type TurnState } from "../shared/turnOrder";
import {
  deleteGonePushSubscription,
  loadPushSubscriptions,
  type PushSubscriptionRow,
} from "./db/pushRepo";
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
   * The requester's position in `saved`'s rotation. It is not the position they held when they
   * loaded the story if they joined or rejoined: both take a new place at the end. The requester
   * is never pushed; they just acted and have the story open.
   */
  requesterPosition: number;
  now: number;
}

interface HolderPush {
  change: TurnChange;
  holderPosition: number;
  /** The app's origin, so the notification opens the story on the host that sent it. */
  origin: string;
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

  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    pushToHolder(c.env, pushSender, { change, holderPosition, origin, turnEndsAt: endsAt }),
  );
}

// The sender is built only once there is someone to send to, so an environment without VAPID
// keys fails (logged) only for a browser that subscribed.
async function pushToHolder(
  env: Env,
  pushSender: (env: Env) => PushSender,
  { change, holderPosition, origin, turnEndsAt: endsAt }: HolderPush,
): Promise<void> {
  try {
    const holder = change.loaded.activeParticipants.find((p) => p.position === holderPosition);
    if (holder === undefined) {
      throw new Error(
        `Story ${change.storyId} has no writer at position ${String(holderPosition)}`,
      );
    }

    const subscriptions = await loadPushSubscriptions(env.DB, holder.browserTokenHash);
    if (subscriptions.length === 0) {
      return;
    }

    const sender = pushSender(env);
    const message = turnNotification({
      storyId: change.storyId,
      opening: await loadOpeningText(env.DB, change.storyId),
      origin,
      now: change.now,
      turnEndsAt: endsAt,
    });
    await Promise.all(
      subscriptions.map((subscription) => sendAndForgetGone(env.DB, sender, subscription, message)),
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
      await deleteGonePushSubscription(db, subscription.endpoint);
    }
  } catch (error) {
    console.error("Push to one subscription failed", error);
  }
}
