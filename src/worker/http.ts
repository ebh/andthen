import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

import type { ErrorBody, ErrorCode, PlainErrorCode } from "../shared/api";
import { API_LEVEL_HEADER, parseApiLevel } from "../shared/apiLevel";
import { DEVICE_TOKEN_HEADER } from "../shared/deviceToken";
import { readOfferedSubprotocols } from "../shared/liveSubprotocol";
import { MAX_BODY_BYTES } from "./config";

export type AppContext = Context<{ Bindings: Env }>;

/** What `isTrustedOrigin` weighs: the request's `Origin` header and whether it names a caller. */
export interface OriginCheck {
  /** The `Origin` header, or undefined when the request sent none. The string "null" is a value. */
  origin: string | undefined;
  /** The request's own origin. */
  ownOrigin: string;
  /** Whether the request carries a device token or a session token. Presence only: the value is checked where the user is resolved. */
  carriesCredential: boolean;
}

/** Thrown by routes and guards; `handleError` turns it into the status and body for its code. */
export class ApiError extends Error {
  readonly code: PlainErrorCode;
  /** The `WWW-Authenticate` value for an `invalid_session_token`; the rejected-token one when unset. */
  readonly challenge: string | undefined;

  constructor(code: PlainErrorCode, challenge?: string) {
    super(code);
    this.code = code;
    this.challenge = challenge;
  }
}

/** Thrown for a browser that left the story; `left_story` is the one code whose body has more. */
export class LeftStoryError extends Error {
  readonly displayName: string;
  readonly opening: string;

  constructor(displayName: string, opening: string) {
    super("left_story");
    this.displayName = displayName;
    this.opening = opening;
  }
}

// Every code has exactly one status, and every status here belongs to one code.
const ERROR_STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  invalid_passage: 400,
  invalid_display_name: 400,
  forbidden_origin: 403,
  not_participant: 403,
  not_your_turn: 403,
  cannot_skip_self: 403,
  not_found: 404,
  payload_too_large: 413,
  stale_turn: 409,
  name_taken: 409,
  story_full: 409,
  already_joined: 409,
  left_story: 403,
  client_outdated: 426,
  invalid_session_token: 401,
  no_one_to_skip_to: 409,
  ai_rate_limited: 429,
  ai_unavailable: 503,
  internal_error: 500,
};

// `application/json`, optionally followed by parameters such as `; charset=utf-8`.
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

// RFC 6750 section 3.1: a request that sent a token gets `error`, one that sent none does not.
const REJECTED_TOKEN_CHALLENGE = 'Bearer error="invalid_token"';

/** For a request that needs a session token and sent no credentials at all. */
export const NO_TOKEN_CHALLENGE = "Bearer";

const HEALTH_PATH = "/api/health";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a client whose `X-Api-Level` is below `minApiLevel` with `client_outdated`, and a
 * malformed one with `bad_request`. A request with no header passes: curl, uptime checks and
 * clients built before the header existed send none. `/api/health` is never refused.
 */
export function requireApiLevel(minApiLevel: number): (c: AppContext, next: Next) => Promise<void> {
  return async (c, next) => {
    if (c.req.path !== HEALTH_PATH) {
      const parsed = parseApiLevel(c.req.header(API_LEVEL_HEADER));
      if (parsed.type === "invalid") {
        throw new ApiError("bad_request");
      }
      if (parsed.type === "level" && parsed.level < minApiLevel) {
        throw new ApiError("client_outdated");
      }
    }

    await next();
  };
}

/**
 * Same-origin check on every mutating request, `application/json` on every body, and no body at
 * all on a `DELETE`, whose path names everything it removes.
 */
export async function guardMutation(c: AppContext, next: Next): Promise<void> {
  if (!SAFE_METHODS.has(c.req.method)) {
    requireTrustedOrigin(c);
    if (!isJsonOrBodylessDelete(c)) {
      throw new ApiError("bad_request");
    }
  }

  await next();
}

/**
 * Throws `forbidden_origin` unless `isTrustedOrigin` accepts the request. The live upgrade is a
 * `GET`, so its route calls this itself.
 */
export function requireTrustedOrigin(c: AppContext): void {
  const trusted = isTrustedOrigin({
    origin: c.req.header("Origin"),
    ownOrigin: new URL(c.req.url).origin,
    carriesCredential: hasCredentialHeader(c),
  });
  if (!trusted) {
    throw new ApiError("forbidden_origin");
  }
}

/**
 * An `Origin` that is present must be the request's own, whatever else the request carries. A
 * browser always sends one on a POST and on a WebSocket handshake, so a missing `Origin` means a
 * native client, and it is accepted only with a credential in a header. A cross-site page can't
 * add a header like that without a preflight, and the Worker answers none, so the credential
 * stands in for the same-origin check.
 */
export function isTrustedOrigin({ origin, ownOrigin, carriesCredential }: OriginCheck): boolean {
  return origin === undefined ? carriesCredential : origin === ownOrigin;
}

/** Whether the request names a caller in a header a cross-site page can't add: a device token or a session token. */
function hasCredentialHeader(c: AppContext): boolean {
  return (
    c.req.header(DEVICE_TOKEN_HEADER) !== undefined ||
    c.req.header("Authorization") !== undefined ||
    (isWebSocketUpgrade(c) &&
      readOfferedSubprotocols(c.req.header("Sec-WebSocket-Protocol")).sessionToken !== null)
  );
}

export function isWebSocketUpgrade(c: AppContext): boolean {
  return c.req.header("Upgrade")?.toLowerCase() === "websocket";
}

/** Refuses a body over MAX_BODY_BYTES (413) before a route reads it. */
export const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json(errorBody("payload_too_large"), ERROR_STATUS.payload_too_large),
});

/** Reads and validates the query string. A failure is `bad_request`. */
export function parseQuery<T>(c: AppContext, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new ApiError("bad_request");
  }

  return parsed.data;
}

/** Reads and validates a JSON body. A parse or schema failure is `bad_request`. */
export async function parseJsonBody<T>(c: AppContext, schema: z.ZodType<T>): Promise<T> {
  // Read as text first: an oversize body must surface as the body-limit error, not bad_request.
  const text = await c.req.text();

  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new ApiError("bad_request");
  }
}

export function handleError(error: Error, c: AppContext): Response {
  if (error instanceof ApiError) {
    if (error.code === "invalid_session_token") {
      c.header("WWW-Authenticate", error.challenge ?? REJECTED_TOKEN_CHALLENGE);
    }

    return c.json(errorBody(error.code), ERROR_STATUS[error.code]);
  }
  if (error instanceof LeftStoryError) {
    const body: ErrorBody = {
      error: "left_story",
      displayName: error.displayName,
      opening: error.opening,
    };
    return c.json(body, ERROR_STATUS.left_story);
  }

  console.error(error);
  return c.json(errorBody("internal_error"), ERROR_STATUS.internal_error);
}

export function handleNotFound(c: AppContext): Response {
  return c.json(errorBody("not_found"), ERROR_STATUS.not_found);
}

/** Keeps private API responses (story text, IDs, the cookie) out of shared and browser caches. */
export async function noStore(c: AppContext, next: Next): Promise<void> {
  await next();

  // A WebSocket upgrade response has immutable headers.
  if (c.res.status !== 101) {
    c.header("Cache-Control", "no-store");
  }
}

function isJsonOrBodylessDelete(c: AppContext): boolean {
  return c.req.method === "DELETE" ? hasNoBody(c) : isJson(c.req.header("Content-Type"));
}

// Not `request.body === null`: behind the dev proxy and in browsers' fetch the runtime can hand a
// bodyless DELETE an empty stream. HTTP says a body is announced by one of these two headers.
function hasNoBody(c: AppContext): boolean {
  const length = c.req.header("Content-Length");

  return (
    c.req.header("Transfer-Encoding") === undefined && (length === undefined || length === "0")
  );
}

function isJson(contentType: string | undefined): boolean {
  return Boolean(contentType?.match(JSON_CONTENT_TYPE));
}

function errorBody(code: PlainErrorCode): ErrorBody {
  return { error: code };
}
