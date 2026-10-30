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

/** `turnVersion` is the version the page showed; a stale one gets 409 `stale_turn`. */
export const contributeRequestSchema = z.object({
  text: z.string(),
  turnVersion: turnVersionSchema,
});
export type ContributeRequest = z.infer<typeof contributeRequestSchema>;

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
  "stale_turn",
  "not_your_turn",
  "cannot_skip_self",
  "no_one_to_skip_to",
  "name_taken",
  "invalid_passage",
  "invalid_display_name",
  "ai_unavailable",
  "ai_rate_limited",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorBodySchema = z.object({ error: errorCodeSchema });
export type ErrorBody = z.infer<typeof errorBodySchema>;
