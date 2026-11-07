import { hashBrowserToken, readBrowserToken, readOrIssueBrowserToken } from "./cookies";
import { createAnonymousUser, findUserByBrowserTokenHash, type UserRow } from "./db/userRepo";
import type { AppContext } from "./http";
import { newId } from "./ids";

/** The user making the request, or null when there is none. Never creates a user or a cookie. */
export async function resolveMe(c: AppContext): Promise<UserRow | null> {
  const token = readBrowserToken(c);
  if (token === "") {
    return null;
  }

  return findUserByBrowserTokenHash(c.env.DB, await hashBrowserToken(token));
}

/**
 * The user making the request. A browser with no user yet gets one, and a browser with no token
 * gets a token in a `Set-Cookie` header. For writes that may start a person's history.
 */
export async function requireOrCreateMe(c: AppContext, now: number): Promise<UserRow> {
  const browserTokenHash = await hashBrowserToken(readOrIssueBrowserToken(c));
  const existing = await findUserByBrowserTokenHash(c.env.DB, browserTokenHash);

  return (
    existing ?? createAnonymousUser(c.env.DB, { id: newId(), browserTokenHash, createdAt: now })
  );
}
