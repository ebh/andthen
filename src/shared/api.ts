import { z } from "zod";

import { MY_STORIES_DEFAULT_LIMIT, MY_STORIES_MAX_LIMIT, normaliseStoryId } from "./validation";

// Request bodies carry plain strings: routes run validatePassage and validateDisplayName, so the
// length rules live in one place and fail with invalid_passage or invalid_display_name.

export const healthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

const idSchema = z.string().min(1);
const timestampSchema = z.number().int().nonnegative();
const turnVersionSchema = z.number().int().nonnegative();

/** A stored story ID: valid and already lowercase. */
export const storyIdSchema = z.string().refine((id) => normaliseStoryId(id) === id);

/**
 * `displayName` is the user's one name across stories: required while the user has none (see
 * `GET /api/users/me`) and refused once they have one.
 */
export const createStoryRequestSchema = z.object({
  displayName: z.string().optional(),
  opening: z.string(),
});
export type CreateStoryRequest = z.infer<typeof createStoryRequestSchema>;

export const createStoryResponseSchema = z.object({ storyId: storyIdSchema });
export type CreateStoryResponse = z.infer<typeof createStoryResponseSchema>;

/** `displayName` follows the same rule as in `createStoryRequestSchema`. */
export const joinRequestSchema = z.object({ displayName: z.string().optional() });
export type JoinRequest = z.infer<typeof joinRequestSchema>;

/** The new participant's ID: the `me` the story view will report for this browser. */
export const joinResponseSchema = z.object({ participantId: idSchema });
export type JoinResponse = z.infer<typeof joinResponseSchema>;

/**
 * `turnVersion` is the version the page showed; a stale one gets 409 `stale_turn`.
 * `startsParagraph` is true when the passage opens a new paragraph rather than continuing one.
 */
export const createPassageRequestSchema = z.object({
  text: z.string(),
  turnVersion: turnVersionSchema,
  startsParagraph: z.boolean(),
});
export type CreatePassageRequest = z.infer<typeof createPassageRequestSchema>;

/** The new passage's ID. */
export const createPassageResponseSchema = z.object({ passageId: idSchema });
export type CreatePassageResponse = z.infer<typeof createPassageResponseSchema>;

/** The body of a route that takes no input. Anything else in it is refused. */
export const emptyRequestSchema = z.strictObject({});

export const skipRequestSchema = z.object({ turnVersion: turnVersionSchema });
export type SkipRequest = z.infer<typeof skipRequestSchema>;

/** A holder always has an end time; a waiting story has neither. */
export const turnViewSchema = z.union([
  z.object({ holderId: idSchema, endsAt: timestampSchema, version: turnVersionSchema }),
  z.object({ holderId: z.null(), endsAt: z.null(), version: turnVersionSchema }),
]);
export type TurnView = z.infer<typeof turnViewSchema>;

/** `userId` is the ID a passage's `authorId` holds, so a client can match authors to participants. */
export const participantViewSchema = z.object({
  id: idSchema,
  userId: idSchema,
  displayName: z.string(),
});
export type ParticipantView = z.infer<typeof participantViewSchema>;

/** `authorId` is the author's user ID, the same in every story. */
export const passageViewSchema = z.object({
  id: idSchema,
  authorId: idSchema,
  authorName: z.string(),
  text: z.string(),
  startsParagraph: z.boolean(),
  createdAt: timestampSchema,
});
export type PassageView = z.infer<typeof passageViewSchema>;

/** Passages oldest first; participants in turn order; `me` is the caller's participant ID. */
export const storyViewSchema = z.object({
  passages: z.array(passageViewSchema),
  participants: z.array(participantViewSchema),
  turn: turnViewSchema,
  me: idSchema,
});
export type StoryView = z.infer<typeof storyViewSchema>;

/** The requesting user, as `GET /api/users/me` reports them. `displayName` is null until they have one. */
export const meResponseSchema = z.object({ displayName: z.string().nullable() });
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `blockedUserId` is the ID a passage's `authorId` holds, so a client can match authors to blocks. */
export const blockUserRequestSchema = z.object({ blockedUserId: idSchema });
export type BlockUserRequest = z.infer<typeof blockUserRequestSchema>;

export const blockUserResponseSchema = z.object({ blockId: idSchema });
export type BlockUserResponse = z.infer<typeof blockUserResponseSchema>;

/** The caller's blocks, oldest first. */
export const blocksResponseSchema = z.object({
  blocks: z.array(z.object({ id: idSchema, blockedUserId: idSchema })),
});
export type BlocksResponse = z.infer<typeof blocksResponseSchema>;

/**
 * A story the caller is in, as the list of their stories shows it. `opening` is the first passage
 * in full, and `openingAuthorId` its author's user ID; the page decides how much of it to show. An
 * older Worker omits `openingAuthorId`, and the page then hides the opening. A waiting story has no
 * holder and no end time.
 */
export const storySummarySchema = z.object({
  id: storyIdSchema,
  opening: z.string(),
  openingAuthorId: idSchema.optional(),
  holderName: z.string().nullable(),
  isMyTurn: z.boolean(),
  endsAt: timestampSchema.nullable(),
  writerCount: z.number().int().positive(),
});
export type StorySummary = z.infer<typeof storySummarySchema>;

/**
 * The query of `GET /api/stories`. `limit` is a plain positive decimal; `cursor` is the
 * `nextCursor` of the previous page, which is opaque to the client.
 */
export const myStoriesQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.number().max(MY_STORIES_MAX_LIMIT))
    .default(MY_STORIES_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

/**
 * One page of the caller's stories that they have not left: the one they hold the turn in first,
 * then newest passage first. `nextCursor` is null on the last page.
 */
export const myStoriesResponseSchema = z.object({
  stories: z.array(storySummarySchema),
  nextCursor: z.string().nullable(),
});
export type MyStoriesResponse = z.infer<typeof myStoriesResponseSchema>;

export const suggestionsResponseSchema = z.object({
  suggestions: z.tuple([z.string(), z.string(), z.string()]),
});
export type SuggestionsResponse = z.infer<typeof suggestionsResponseSchema>;

/** Sent over the story's WebSocket after any change. Clients refetch on every message. */
export const liveMessageSchema = z.object({ version: turnVersionSchema });
export type LiveMessage = z.infer<typeof liveMessageSchema>;

const MAX_PUSH_ENDPOINT_LENGTH = 2048;

// Unpadded base64url, as a browser's `PushSubscription.toJSON()` writes it. A P-256 public key is
// 65 bytes (87 characters) and the authentication secret is 16 bytes (22 characters).
const subscriptionKeySchema = (length: number) =>
  z
    .string()
    .length(length)
    .regex(/^[A-Za-z0-9_-]+$/);

const pushEndpointSchema = z.url({ protocol: /^https$/ }).max(MAX_PUSH_ENDPOINT_LENGTH);

// The hosts of the push services browsers use: Chrome and Edge (FCM), Firefox, Safari and
// Windows. Without a limit the Worker would POST to any https host a client names.
const PUSH_SERVICE_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const PUSH_SERVICE_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

/**
 * Whether `endpoint` is an https URL on a known push service: an exact host, or a subdomain of
 * an Apple or Windows push domain (matched on the dot, so `xpush.apple.com` is not one). A port
 * or userinfo is refused because no push service uses either.
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  const url = URL.parse(endpoint);
  if (url === null || url.protocol !== "https:") {
    return false;
  }
  if (url.port !== "" || url.username !== "" || url.password !== "") {
    return false;
  }

  return (
    PUSH_SERVICE_HOSTS.has(url.hostname) ||
    PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
  );
}

/** A browser's Web Push subscription, as `PushSubscription.toJSON()` gives it. */
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema.refine(isPushServiceEndpoint, "not a known push service"),
  keys: z.object({ p256dh: subscriptionKeySchema(87), auth: subscriptionKeySchema(22) }),
});
export type PushSubscriptionRequest = z.infer<typeof pushSubscriptionSchema>;

/** The shape of `pushSubscriptionIdOf`: a SHA-256 as 64 lowercase hex characters. */
export const pushSubscriptionIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The server's VAPID public key, which a browser passes to `pushManager.subscribe`. */
export const vapidPublicKeyResponseSchema = z.object({ publicKey: z.string().min(1) });
export type VapidPublicKeyResponse = z.infer<typeof vapidPublicKeyResponseSchema>;

/**
 * The push message the Worker sends and the service worker shows: the declarative Web Push shape
 * (RFC 8030's `web_push` marker), which Safari shows by itself and other browsers pass to the
 * service worker's `push` handler.
 */
export const turnPushPayloadSchema = z.object({
  web_push: z.literal(8030),
  notification: z.object({
    title: z.string(),
    body: z.string(),
    /** The address to open on a tap: the story's page. */
    navigate: z.url(),
    /** A newer notification with the same tag replaces the older one. */
    tag: z.string(),
  }),
});
export type TurnPushPayload = z.infer<typeof turnPushPayloadSchema>;

// Every error code the API sends. A suggestions request from a non-holder is `not_your_turn`.
export const errorCodeSchema = z.enum([
  "bad_request", // malformed JSON or body, or a Content-Type other than application/json
  "forbidden_origin",
  "not_participant",
  "already_joined", // this browser is already a participant
  "not_found",
  "payload_too_large", // body over the size cap
  "internal_error", // an unexpected server failure
  "stale_turn",
  "not_your_turn",
  "cannot_skip_self",
  "no_one_to_skip_to",
  "name_taken",
  "story_full", // the story already has MAX_PARTICIPANTS; a join is refused
  "invalid_passage",
  "invalid_display_name",
  "ai_unavailable",
  "ai_rate_limited",
  "left_story", // this browser was in the story and left; the body says what to rejoin
  "client_outdated", // the client's API level is below the Worker's minimum; it must update
  "invalid_session_token", // a session token was sent and is expired, forged, for another origin or malformed
  "cannot_block_self", // a user asked to block themselves
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Every code whose body is the code alone. */
export const plainErrorCodeSchema = errorCodeSchema.exclude(["left_story"]);
export type PlainErrorCode = z.infer<typeof plainErrorCodeSchema>;

/**
 * Sent with 403 `left_story` to a browser that left the story: the name it had there and the
 * story's opening passage and its author's user ID (omitted by an older Worker), so the page can
 * offer to rejoin without a second request.
 */
export const leftStoryErrorBodySchema = z.object({
  error: z.literal("left_story"),
  displayName: z.string(),
  opening: z.string(),
  openingAuthorId: idSchema.optional(),
});
export type LeftStoryErrorBody = z.infer<typeof leftStoryErrorBodySchema>;

export const errorBodySchema = z.union([
  leftStoryErrorBodySchema,
  z.object({ error: plainErrorCodeSchema }),
]);
export type ErrorBody = z.infer<typeof errorBodySchema>;
