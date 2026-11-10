import { z } from "zod";

import {
  contributionsTableSchema,
  participantsTableSchema,
  pushSubscriptionsTableSchema,
  storiesTableSchema,
  usersTableSchema,
} from "./tableSchemas";

// Column names are aliased to camelCase in the SQL, so a row parses straight into these shapes.

/** A waiting story has neither a holder nor a start time; a running one has both. */
export const storyRowSchema = z.intersection(
  storiesTableSchema.pick({
    id: true,
    createdAt: true,
    turnVersion: true,
    lastContributorPosition: true,
  }),
  z.union([
    z.object({ currentPosition: z.null(), turnStartedAt: z.null() }),
    z.object({
      currentPosition: storiesTableSchema.shape.currentPosition.unwrap(),
      turnStartedAt: storiesTableSchema.shape.turnStartedAt.unwrap(),
    }),
  ]),
);
export type StoryRow = z.infer<typeof storyRowSchema>;

export const participantRowSchema = participantsTableSchema.pick({
  id: true,
  displayName: true,
  displayNameKey: true,
  position: true,
  userId: true,
  leftAt: true,
});
export type ParticipantRow = z.infer<typeof participantRowSchema>;

/** A contribution with its author's name, as the story view shows it. */
export const contributionRowSchema = contributionsTableSchema
  .pick({ id: true, text: true, createdAt: true })
  .extend({
    authorId: contributionsTableSchema.shape.participantId,
    authorName: participantsTableSchema.shape.displayName,
    startsParagraph: contributionsTableSchema.shape.startsParagraph.transform((flag) => flag === 1),
  });
export type ContributionRow = z.infer<typeof contributionRowSchema>;

/** A story the caller is in, with the position they hold in its turn order. */
export const myStoryRowSchema = z.intersection(
  storyRowSchema,
  z.object({ myPosition: participantsTableSchema.shape.position }),
);
export type MyStoryRow = z.infer<typeof myStoryRowSchema>;

/** One writer who has not left a story, for the list of a user's stories. */
export const storyWriterRowSchema = participantsTableSchema.pick({
  storyId: true,
  displayName: true,
  position: true,
});
export type StoryWriterRow = z.infer<typeof storyWriterRowSchema>;

/** A story's first passage and when its newest passage was written. */
export const storyPassageRowSchema = contributionsTableSchema.pick({ storyId: true }).extend({
  opening: contributionsTableSchema.shape.text,
  latestAt: contributionsTableSchema.shape.createdAt,
});
export type StoryPassageRow = z.infer<typeof storyPassageRowSchema>;

export const openingRowSchema = contributionsTableSchema.pick({ text: true });

export const participantStoryIdRowSchema = participantsTableSchema.pick({ storyId: true });

export const userRowSchema = usersTableSchema.pick({ id: true });
export type UserRow = z.infer<typeof userRowSchema>;

/** What a push needs to reach one browser. */
export const pushSubscriptionRowSchema = pushSubscriptionsTableSchema.pick({
  endpoint: true,
  p256dh: true,
  auth: true,
});
export type PushSubscriptionRow = z.infer<typeof pushSubscriptionRowSchema>;
