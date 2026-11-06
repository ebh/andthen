import { z } from "zod";

import type { Db } from "./storyRepo";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NewPushSubscription extends PushSubscriptionRow {
  browserTokenHash: string;
  createdAt: number;
}

const pushSubscriptionRowSchema = z.object({
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
});

/**
 * Stores a subscription for a browser. A stored endpoint is taken over: its keys and owner are
 * replaced, because a push service hands the same endpoint to a browser that subscribes again.
 * `created_at` keeps its first value.
 */
export async function savePushSubscription(db: Db, input: NewPushSubscription): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, browser_token_hash, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET
         browser_token_hash = excluded.browser_token_hash,
         p256dh = excluded.p256dh,
         auth = excluded.auth`,
    )
    .bind(input.endpoint, input.browserTokenHash, input.p256dh, input.auth, input.createdAt)
    .run();
}

/** Every subscription of one browser, oldest first. */
export async function loadPushSubscriptions(
  db: Db,
  browserTokenHash: string,
): Promise<PushSubscriptionRow[]> {
  const result = await db
    .prepare(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions
       WHERE browser_token_hash = ? ORDER BY created_at, endpoint`,
    )
    .bind(browserTokenHash)
    .all();

  return z.array(pushSubscriptionRowSchema).parse(result.results);
}

/** Removes a browser's own subscription to `endpoint`. Another browser's is left alone. */
export async function deletePushSubscription(
  db: Db,
  browserTokenHash: string,
  endpoint: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND browser_token_hash = ?")
    .bind(endpoint, browserTokenHash)
    .run();
}

/** Removes a subscription the push service reported gone, whoever owned it. */
export async function deleteGonePushSubscription(db: Db, endpoint: string): Promise<void> {
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
}
