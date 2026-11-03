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
  /** Epoch ms when they left the story; null while they are in it. */
  leftAt: countSchema.nullable(),
});
export type ParticipantRow = z.infer<typeof participantRowSchema>;

/** A contribution with its author's name, as the story view shows it. */
export const contributionRowSchema = z.object({
  id: z.string().min(1),
  authorId: z.string().min(1),
  authorName: z.string(),
  text: z.string(),
  startsParagraph: z.union([z.literal(0), z.literal(1)]).transform((flag) => flag === 1),
  createdAt: countSchema,
});
export type ContributionRow = z.infer<typeof contributionRowSchema>;

/** A story the caller is in, with the position they hold in its rotation. */
export const myStoryRowSchema = z.intersection(
  storyRowSchema,
  z.object({ myPosition: countSchema }),
);
export type MyStoryRow = z.infer<typeof myStoryRowSchema>;

/** One writer who has not left a story, for the list of a browser's stories. */
export const storyWriterRowSchema = z.object({
  storyId: storyIdSchema,
  displayName: z.string(),
  position: countSchema,
});
export type StoryWriterRow = z.infer<typeof storyWriterRowSchema>;

/** A story's first passage and when its newest passage was written. */
export const storyPassageRowSchema = z.object({
  storyId: storyIdSchema,
  opening: z.string(),
  latestAt: countSchema,
});
export type StoryPassageRow = z.infer<typeof storyPassageRowSchema>;
