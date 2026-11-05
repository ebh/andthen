import { z } from "zod";

import { normaliseStoryId } from "./validation";

// Request bodies carry plain strings: routes run validatePassage and validateDisplayName, so the
// length rules live in one place and fail with invalid_passage or invalid_display_name.

export const healthResponseSchema = z.object({ status: z.literal("ok") });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

const idSchema = z.string().min(1);
const timestampSchema = z.number().int().nonnegative();
const turnVersionSchema = z.number().int().nonnegative();

/** A stored story ID: valid and already lowercase. */
export const storyIdSchema = z.string().refine((id) => normaliseStoryId(id) === id);

export const createStoryRequestSchema = z.object({ displayName: z.string(), opening: z.string() });
export type CreateStoryRequest = z.infer<typeof createStoryRequestSchema>;

export const createStoryResponseSchema = z.object({ storyId: storyIdSchema });
export type CreateStoryResponse = z.infer<typeof createStoryResponseSchema>;

export const joinRequestSchema = z.object({ displayName: z.string() });
export type JoinRequest = z.infer<typeof joinRequestSchema>;

/** The new participant's ID: the `me` the story view will report for this browser. */
export const joinResponseSchema = z.object({ participantId: idSchema });
export type JoinResponse = z.infer<typeof joinResponseSchema>;

/**
 * `turnVersion` is the version the page showed; a stale one gets 409 `stale_turn`.
 * `startsParagraph` is true when the passage opens a new paragraph rather than continuing one.
 */
export const contributeRequestSchema = z.object({
  text: z.string(),
  turnVersion: turnVersionSchema,
  startsParagraph: z.boolean(),
});
export type ContributeRequest = z.infer<typeof contributeRequestSchema>;

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

export const participantViewSchema = z.object({ id: idSchema, displayName: z.string() });
export type ParticipantView = z.infer<typeof participantViewSchema>;

export const contributionViewSchema = z.object({
  id: idSchema,
  authorId: idSchema,
  authorName: z.string(),
  text: z.string(),
  startsParagraph: z.boolean(),
  createdAt: timestampSchema,
});
export type ContributionView = z.infer<typeof contributionViewSchema>;

/** Contributions oldest first; participants in rotation order; `me` is the caller's participant ID. */
export const storyViewSchema = z.object({
  contributions: z.array(contributionViewSchema),
  participants: z.array(participantViewSchema),
  turn: turnViewSchema,
  me: idSchema,
});
export type StoryView = z.infer<typeof storyViewSchema>;

/**
 * A story the caller is in, as the list of their stories shows it. `opening` is the first passage
 * in full; the page decides how much of it to show. A waiting story has no holder and no end time.
 */
export const storySummarySchema = z.object({
  id: storyIdSchema,
  opening: z.string(),
  holderName: z.string().nullable(),
  isMyTurn: z.boolean(),
  endsAt: timestampSchema.nullable(),
  writerCount: z.number().int().positive(),
});
export type StorySummary = z.infer<typeof storySummarySchema>;

/** The caller's stories that they have not left: the one they hold the turn in first, then newest passage first. */
export const myStoriesResponseSchema = z.object({ stories: z.array(storySummarySchema) });
export type MyStoriesResponse = z.infer<typeof myStoriesResponseSchema>;

export const suggestionsResponseSchema = z.object({
  suggestions: z.tuple([z.string(), z.string(), z.string()]),
});
export type SuggestionsResponse = z.infer<typeof suggestionsResponseSchema>;

/** Sent over the story's WebSocket after any change. Clients refetch on every message. */
export const liveMessageSchema = z.object({ version: turnVersionSchema });
export type LiveMessage = z.infer<typeof liveMessageSchema>;

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
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Every code whose body is the code alone. */
export const plainErrorCodeSchema = errorCodeSchema.exclude(["left_story"]);
export type PlainErrorCode = z.infer<typeof plainErrorCodeSchema>;

/**
 * Sent with 403 `left_story` to a browser that left the story: the name it had there and the
 * story's opening passage, so the page can offer to rejoin without a second request.
 */
export const leftStoryErrorBodySchema = z.object({
  error: z.literal("left_story"),
  displayName: z.string(),
  opening: z.string(),
});
export type LeftStoryErrorBody = z.infer<typeof leftStoryErrorBodySchema>;

export const errorBodySchema = z.union([
  leftStoryErrorBodySchema,
  z.object({ error: plainErrorCodeSchema }),
]);
export type ErrorBody = z.infer<typeof errorBodySchema>;
