import { z } from "zod";

import { participantStoryIdRowSchema, userRowSchema, type UserRow } from "./rows";
import type { Db } from "./storyRepo";
import type { NewAccountUser, NewAnonymousUser } from "./typeSchemas";

/** The user whose browser has this token hash, or null when it names none. */
export async function findUserByBrowserTokenHash(
  db: Db,
  browserTokenHash: string,
): Promise<UserRow | null> {
  const result = await db
    .prepare("SELECT id FROM users WHERE browser_token_hash = ?")
    .bind(browserTokenHash)
    .all();
  const [row] = z.array(userRowSchema).parse(result.results);

  return row ?? null;
}

/**
 * Creates the anonymous user for a browser token hash. When a concurrent request already created
 * one, that user is returned and `input.id` is not stored.
 */
export async function createAnonymousUser(db: Db, input: NewAnonymousUser): Promise<UserRow> {
  await db
    .prepare(
      `INSERT INTO users (id, browser_token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT (browser_token_hash) DO NOTHING`,
    )
    .bind(input.id, input.browserTokenHash, input.createdAt)
    .run();

  const user = await findUserByBrowserTokenHash(db, input.browserTokenHash);
  if (user === null) {
    throw new Error("Anonymous user missing right after its insert");
  }

  return user;
}

/** The user who holds this Clerk user id, or null when nobody does. */
export async function findUserByClerkUserId(db: Db, clerkUserId: string): Promise<UserRow | null> {
  const result = await db
    .prepare("SELECT id FROM users WHERE clerk_user_id = ?")
    .bind(clerkUserId)
    .all();
  const [row] = z.array(userRowSchema).parse(result.results);

  return row ?? null;
}

/**
 * Creates the account user for a Clerk user id. When a concurrent request already created one,
 * that user is returned and `input.id` is not stored.
 */
export async function createAccountUser(db: Db, input: NewAccountUser): Promise<UserRow> {
  await db
    .prepare(
      `INSERT INTO users (id, clerk_user_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT (clerk_user_id) DO NOTHING`,
    )
    .bind(input.id, input.clerkUserId, input.createdAt)
    .run();

  const user = await findUserByClerkUserId(db, input.clerkUserId);
  if (user === null) {
    throw new Error("Account user missing right after its insert");
  }

  return user;
}

/**
 * Makes `userId`, an anonymous user, the holder of `clerkUserId` and drops its browser token, so
 * the cookie names no user from now on. False when `userId` is not anonymous or somebody else
 * already holds `clerkUserId`; nothing is written then.
 */
export async function attachAccount(db: Db, userId: string, clerkUserId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE users SET clerk_user_id = ?, browser_token_hash = NULL
       WHERE id = ? AND clerk_user_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM users WHERE clerk_user_id = ?)`,
    )
    .bind(clerkUserId, userId, clerkUserId)
    .run();

  return result.meta.changes === 1;
}

/** The stories in which both users are writers who have not left. */
export async function storiesWithBothActive(
  db: Db,
  userId: string,
  otherUserId: string,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT p.story_id AS storyId FROM participants p
       JOIN participants other ON other.story_id = p.story_id
         AND other.user_id = ? AND other.left_at IS NULL
       WHERE p.user_id = ? AND p.left_at IS NULL
       ORDER BY p.story_id`,
    )
    .bind(otherUserId, userId)
    .all();

  return z
    .array(participantStoryIdRowSchema)
    .parse(result.results)
    .map(({ storyId }) => storyId);
}

/**
 * Hands everything `fromUserId` has to `intoUserId` and deletes `fromUserId`, in one batch. The
 * two users must not both be active in one story: a user has one active participant per story,
 * and the batch fails whole if that would break. Repeating it after it succeeded changes nothing.
 */
export async function mergeUserInto(db: Db, fromUserId: string, intoUserId: string): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE participants SET user_id = ? WHERE user_id = ?")
      .bind(intoUserId, fromUserId),
    db
      .prepare("UPDATE push_subscriptions SET user_id = ? WHERE user_id = ?")
      .bind(intoUserId, fromUserId),
    db.prepare("DELETE FROM users WHERE id = ?").bind(fromUserId),
  ]);
}
