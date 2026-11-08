import { readOfferedSubprotocols } from "../shared/liveSubprotocol";
import { hashBrowserToken, readDeviceToken, readOrIssueDeviceToken } from "./cookies";
import {
  createAccountUser,
  createAnonymousUser,
  findUserByBrowserTokenHash,
  findUserByClerkUserId,
  type UserRow,
} from "./db/userRepo";
import { ApiError, isWebSocketUpgrade, NO_TOKEN_CHALLENGE, type AppContext } from "./http";
import { newId } from "./ids";
import type { SessionVerifier } from "./sessionToken";

export interface MeDeps {
  /** The clock, in epoch milliseconds. */
  now: () => number;
  /** The verifier for this request's bindings; tests use the real one with a test key. */
  sessionVerifier: (env: Env) => SessionVerifier;
}

/** A session token that passed verification. */
export interface VerifiedSession {
  clerkUserId: string;
}

/**
 * The user making the request, or null when there is none. Never creates a user or a cookie.
 *
 * A session token decides alone: the browser token is not consulted, so a rejected token can't
 * quietly turn a signed-in request into an anonymous one. Throws `invalid_session_token` for a
 * token that is present and bad.
 */
export async function resolveMe(c: AppContext, deps: MeDeps): Promise<UserRow | null> {
  const session = await verifiedSession(c, deps);
  if (session !== null) {
    return findUserByClerkUserId(c.env.DB, session.clerkUserId);
  }

  return findDeviceUser(c);
}

/**
 * The user making the request, created when there is none yet. A session token makes an account
 * user; no token makes an anonymous user and issues the browser token in a `Set-Cookie` header
 * when the browser has none. For writes that may start a person's history.
 */
export async function requireOrCreateMe(c: AppContext, deps: MeDeps): Promise<UserRow> {
  const session = await verifiedSession(c, deps);
  if (session !== null) {
    return (
      (await findUserByClerkUserId(c.env.DB, session.clerkUserId)) ??
      createAccountUser(c.env.DB, {
        id: newId(),
        clerkUserId: session.clerkUserId,
        createdAt: deps.now(),
      })
    );
  }

  const browserTokenHash = await hashBrowserToken(readOrIssueDeviceToken(c));

  return (
    (await findUserByBrowserTokenHash(c.env.DB, browserTokenHash)) ??
    createAnonymousUser(c.env.DB, { id: newId(), browserTokenHash, createdAt: deps.now() })
  );
}

/** The verified session token of a request that must be signed in; throws 401 when it has none. */
export async function requireSession(c: AppContext, deps: MeDeps): Promise<VerifiedSession> {
  const session = await verifiedSession(c, deps);
  if (session === null) {
    throw new ApiError("invalid_session_token", NO_TOKEN_CHALLENGE);
  }

  return session;
}

/**
 * The user this device's token names, whether or not the request also carries a session token.
 * Null when it has no token or the token names no user.
 */
export async function findDeviceUser(c: AppContext): Promise<UserRow | null> {
  const token = readDeviceToken(c);
  if (token === null) {
    return null;
  }

  return findUserByBrowserTokenHash(c.env.DB, await hashBrowserToken(token));
}

// Null when the request carries no session token. A token that is present and bad throws.
async function verifiedSession(c: AppContext, deps: MeDeps): Promise<VerifiedSession | null> {
  const token = readSessionToken(c);
  if (token === null) {
    return null;
  }

  const verdict = await deps.sessionVerifier(c.env)(token, new URL(c.req.url).origin);
  if (verdict.type === "rejected") {
    console.warn(`Session token rejected: ${verdict.reason}`);
    throw new ApiError("invalid_session_token");
  }

  return { clerkUserId: verdict.clerkUserId };
}

const BEARER_HEADER = /^Bearer (\S+)$/i;

// A browser can't set headers on a WebSocket, so the live socket carries it in its subprotocols.
function readSessionToken(c: AppContext): string | null {
  const header = c.req.header("Authorization");
  if (header === undefined) {
    return isWebSocketUpgrade(c)
      ? readOfferedSubprotocols(c.req.header("Sec-WebSocket-Protocol")).sessionToken
      : null;
  }

  const token = BEARER_HEADER.exec(header)?.[1];
  if (token === undefined) {
    throw new ApiError("invalid_session_token");
  }

  return token;
}
