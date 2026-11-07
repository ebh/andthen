import { hashBrowserToken } from "../../src/worker/cookies";
import { findUserByBrowserTokenHash } from "../../src/worker/db/userRepo";
import type { Browser } from "./browser";

/** Adds an anonymous user straight to D1 and returns its ID, which is `id` itself. */
export async function insertUser(db: Env["DB"], id: string): Promise<string> {
  await db
    .prepare("INSERT INTO users (id, browser_token_hash, created_at) VALUES (?, ?, 0)")
    .bind(id, `hash-of-${id}`)
    .run();

  return id;
}

/** The ID of the user a browser's token names; the browser must have a cookie. */
export async function userIdOf(db: Env["DB"], browser: Browser): Promise<string> {
  const token = browser.cookies.get("andthen_bt");
  if (token === undefined) {
    throw new Error("The browser has no cookie");
  }

  const user = await findUserByBrowserTokenHash(db, await hashBrowserToken(token));
  if (user === null) {
    throw new Error("The browser's token names no user");
  }

  return user.id;
}
