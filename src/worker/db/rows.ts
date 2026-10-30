import { z } from "zod";

import { storyIdSchema } from "../../shared/api";

// Column names are aliased to camelCase in the SQL, so a row parses straight into these shapes.

const countSchema = z.number().int().nonnegative();

/** A waiting story has neither a holder nor a start time; a running one has both. */
export const storyRowSchema = z.intersection(
  z.object({
    id: storyIdSchema,
    createdAt: countSchema,
    turnVersion: countSchema,
    lastContributorPosition: countSchema.nullable(),
  }),
  z.union([
    z.object({ currentPosition: z.null(), turnStartedAt: z.null() }),
    z.object({ currentPosition: countSchema, turnStartedAt: countSchema }),
  ]),
);
export type StoryRow = z.infer<typeof storyRowSchema>;

export const participantRowSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  displayNameKey: z.string(),
  position: countSchema,
  browserTokenHash: z.string(),
});
export type ParticipantRow = z.infer<typeof participantRowSchema>;

/** A contribution with its author's name, as the story view shows it. */
export const contributionRowSchema = z.object({
  id: z.string().min(1),
  authorId: z.string().min(1),
  authorName: z.string(),
  text: z.string(),
  createdAt: countSchema,
});
export type ContributionRow = z.infer<typeof contributionRowSchema>;
