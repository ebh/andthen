import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

import type { ErrorBody, ErrorCode } from "../shared/api";
import { MAX_BODY_BYTES } from "./config";

export type AppContext = Context<{ Bindings: Env }>;

/** Thrown by routes and guards; `handleError` turns it into the status and body for its code. */
export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
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
  no_one_to_skip_to: 409,
  ai_rate_limited: 429,
  ai_unavailable: 503,
  internal_error: 500,
};

// `application/json`, optionally followed by parameters such as `; charset=utf-8`.
const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Same-origin check on every mutating request, and `application/json` on every body. */
export async function guardMutation(c: AppContext, next: Next): Promise<void> {
  if (!SAFE_METHODS.has(c.req.method)) {
    requireSameOrigin(c);
    if (!isJson(c.req.header("Content-Type"))) {
      throw new ApiError("bad_request");
    }
  }

  await next();
}

/**
 * Throws `forbidden_origin` unless the Origin header is the request's own origin. A missing
 * Origin fails too: browsers always send one on a POST and on a WebSocket handshake.
 */
export function requireSameOrigin(c: AppContext): void {
  if (c.req.header("Origin") !== new URL(c.req.url).origin) {
    throw new ApiError("forbidden_origin");
  }
}

/** Refuses a body over MAX_BODY_BYTES (413) before a route reads it. */
export const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json(errorBody("payload_too_large"), ERROR_STATUS.payload_too_large),
});

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
    return c.json(errorBody(error.code), ERROR_STATUS[error.code]);
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

function isJson(contentType: string | undefined): boolean {
  return Boolean(contentType?.match(JSON_CONTENT_TYPE));
}

function errorBody(code: ErrorCode): ErrorBody {
  return { error: code };
}
