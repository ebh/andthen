import { z } from "zod";

import type { Db } from "./storyRepo";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NewPushSubscription extends PushSubscriptionRow {
  userId: string;
  createdAt: number;
}

const pushSubscriptionRowSchema = z.object({
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
});

/**
 * Stores a subscription for a user. A stored endpoint is taken over: its keys and owner are
 * replaced, because a push service hands the same endpoint to a browser that subscribes again.
 * `created_at` keeps its first value.
 */
export async function savePushSubscription(db: Db, input: NewPushSubscription): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    )
    .bind(input.endpoint, input.userId, input.p256dh, input.auth, input.createdAt)
    .run();
}

/** Every subscription of one user, oldest first. */
export async function loadPushSubscriptions(
  db: Db,
  userId: string,
): Promise<PushSubscriptionRow[]> {
  const result = await db
    .prepare(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions
       WHERE user_id = ? ORDER BY created_at, endpoint`,
    )
    .bind(userId)
    .all();

  return z.array(pushSubscriptionRowSchema).parse(result.results);
}

/** Removes a user's own subscription to `endpoint`. Another user's is left alone. */
export async function deletePushSubscription(
  db: Db,
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .bind(endpoint, userId)
    .run();
}

/** Removes the subscription at `endpoint`, whoever owns it: the endpoint is the proof of title. */
export async function deletePushSubscriptionByEndpoint(db: Db, endpoint: string): Promise<void> {
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
}
