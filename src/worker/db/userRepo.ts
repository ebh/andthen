import { z } from "zod";

import { participantStoryIdRowSchema, userRowSchema, type UserRow } from "./rows";
import type { Db } from "./storyRepo";
import type { NewAccountUser, NewAnonymousUser } from "./typeSchemas";

const USER_COLUMNS = "id, display_name AS displayName, display_name_key AS displayNameKey";

/** The user whose browser has this token hash, or null when it names none. */
export async function findUserByBrowserTokenHash(
  db: Db,
  browserTokenHash: string,
): Promise<UserRow | null> {
  const result = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE browser_token_hash = ?`)
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
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE clerk_user_id = ?`)
    .bind(clerkUserId)
    .all();
  const [row] = z.array(userRowSchema).parse(result.results);

  return row ?? null;
}

/** The user with this ID, or null when there is none. */
export async function findUserById(db: Db, userId: string): Promise<UserRow | null> {
  const result = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(userId)
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

/** The user who holds this display name key, or null when nobody does. */
export async function findUserByDisplayNameKey(
  db: Db,
  displayNameKey: string,
): Promise<UserRow | null> {
  const result = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE display_name_key = ?`)
    .bind(displayNameKey)
    .all();
  const [row] = z.array(userRowSchema).parse(result.results);

  return row ?? null;
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
 * Hands everything `from` has to `intoUserId` and deletes `from`, in one batch. The two users must
 * not both be active in one story: a user has one active participant per story, and the batch fails
 * whole if that would break. The display name of `intoUserId` stays; it takes the name of `from`
 * only when it has none. Repeating it after it succeeded changes nothing.
 *
 * In a story where `from` has left and `intoUserId` is active, a passage by `from` becomes a passage
 * by the active participant, so the last contributor moves to that participant too. Otherwise the
 * turn could pass straight back to the person who just wrote.
 *
 * `from` is the row as read before the batch: its name is cleared first, because the key is unique,
 * and then handed on from the values read. False when `from` no longer has the name it was read
 * with, or is gone; nothing is written then, and the caller reads `from` again.
 */
export async function mergeUserInto(db: Db, from: UserRow, intoUserId: string): Promise<boolean> {
  // Every step before the name moves runs only while `from` still has the name it was read with.
  // A user's name only ever goes from none to one, so the race this catches is `from` being named
  // by a join or start that ran after the read. The steps after it run only once the name is gone.
  const nameAsRead = "EXISTS (SELECT 1 FROM users WHERE id = ? AND display_name_key IS ?)";
  const nameCleared = "EXISTS (SELECT 1 FROM users WHERE id = ? AND display_name_key IS NULL)";

  const results = await db.batch([
    db
      .prepare(
        `UPDATE stories SET last_contributor_position = (
           SELECT position FROM participants
           WHERE story_id = stories.id AND user_id = ? AND left_at IS NULL)
         WHERE EXISTS (
             SELECT 1 FROM participants
             WHERE story_id = stories.id AND user_id = ? AND left_at IS NULL)
           AND EXISTS (
             SELECT 1 FROM participants
             WHERE story_id = stories.id AND user_id = ? AND left_at IS NOT NULL
               AND position = stories.last_contributor_position)
           AND ${nameAsRead}`,
      )
      .bind(intoUserId, intoUserId, from.id, from.id, from.displayNameKey),
    db
      .prepare(`UPDATE passages SET author_id = ? WHERE author_id = ? AND ${nameAsRead}`)
      .bind(intoUserId, from.id, from.id, from.displayNameKey),
    db
      .prepare(`UPDATE participants SET user_id = ? WHERE user_id = ? AND ${nameAsRead}`)
      .bind(intoUserId, from.id, from.id, from.displayNameKey),
    db
      .prepare(`UPDATE push_subscriptions SET user_id = ? WHERE user_id = ? AND ${nameAsRead}`)
      .bind(intoUserId, from.id, from.id, from.displayNameKey),
    // OR IGNORE skips a move that would duplicate a pair or make a user block itself. Those rows
    // still point at `from`, and the delete below removes them before the user row goes.
    db
      .prepare(`UPDATE OR IGNORE blocks SET user_id = ? WHERE user_id = ? AND ${nameAsRead}`)
      .bind(intoUserId, from.id, from.id, from.displayNameKey),
    db
      .prepare(
        `UPDATE OR IGNORE blocks SET blocked_user_id = ? WHERE blocked_user_id = ? AND ${nameAsRead}`,
      )
      .bind(intoUserId, from.id, from.id, from.displayNameKey),
    db
      .prepare(`DELETE FROM blocks WHERE (user_id = ? OR blocked_user_id = ?) AND ${nameAsRead}`)
      .bind(from.id, from.id, from.id, from.displayNameKey),
    db
      .prepare(
        `UPDATE users SET display_name = NULL, display_name_key = NULL
         WHERE id = ? AND display_name_key IS ?`,
      )
      .bind(from.id, from.displayNameKey),
    db
      .prepare(
        `UPDATE users SET display_name = ?, display_name_key = ?
         WHERE id = ? AND display_name IS NULL AND ${nameCleared}`,
      )
      .bind(from.displayName, from.displayNameKey, intoUserId, from.id),
    db.prepare(`DELETE FROM users WHERE id = ? AND ${nameCleared}`).bind(from.id, from.id),
  ]);

  const deleted = results.at(-1);
  if (deleted === undefined) {
    throw new Error("D1 batch returned no result for the delete");
  }

  return deleted.meta.changes === 1;
}
