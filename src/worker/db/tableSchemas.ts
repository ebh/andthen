import { z } from "zod";

import { storyIdSchema } from "../../shared/api";

const countSchema = z.number().int().nonnegative();
const idSchema = z.string().min(1);

export const storiesTableSchema = z.object({
  id: storyIdSchema,
  createdAt: countSchema,
  currentPosition: countSchema.nullable(),
  turnStartedAt: countSchema.nullable(),
  turnVersion: countSchema,
  lastContributorPosition: countSchema.nullable(),
});

export const participantsTableSchema = z.object({
  id: idSchema,
  storyId: storyIdSchema,
  displayName: z.string(),
  displayNameKey: z.string(),
  position: countSchema,
  userId: idSchema,
  joinedAt: countSchema,
  /** Epoch ms when they left the story; null while they are in it. */
  leftAt: countSchema.nullable(),
});

export const contributionsTableSchema = z.object({
  id: idSchema,
  storyId: storyIdSchema,
  participantId: idSchema,
  seq: countSchema,
  text: z.string(),
  startsParagraph: z.union([z.literal(0), z.literal(1)]),
  createdAt: countSchema,
});

export const suggestionRequestsTableSchema = z.object({
  id: idSchema,
  participantId: idSchema,
  createdAt: countSchema,
});

export const usersTableSchema = z.object({
  id: idSchema,
  clerkUserId: z.string().nullable(),
  browserTokenHash: z.string().nullable(),
  createdAt: countSchema,
});

export const pushSubscriptionsTableSchema = z.object({
  endpoint: z.string(),
  userId: idSchema,
  p256dh: z.string(),
  auth: z.string(),
  createdAt: countSchema,
});

/** Every table schema, under its SQL table name. */
export const TABLE_SCHEMAS = {
  stories: storiesTableSchema,
  participants: participantsTableSchema,
  contributions: contributionsTableSchema,
  suggestion_requests: suggestionRequestsTableSchema,
  users: usersTableSchema,
  push_subscriptions: pushSubscriptionsTableSchema,
};
