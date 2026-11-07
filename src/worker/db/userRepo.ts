import { z } from "zod";

import type { Db } from "./storyRepo";

export interface UserRow {
  id: string;
}

export interface NewAccountUser {
  id: string;
  clerkUserId: string;
  createdAt: number;
}

export interface NewAnonymousUser {
  id: string;
  browserTokenHash: string;
  createdAt: number;
}

const userRowSchema = z.object({ id: z.string().min(1) });

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
