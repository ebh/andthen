import { z } from "zod";

import type { TurnState } from "../../shared/turnOrder";
import {
  databaseColumnRowSchema,
  foreignKeyRowSchema,
  indexRowSchema,
  myStoryRowSchema,
  participantRowSchema,
  passageRowSchema,
  storyPassageRowSchema,
  storyRowSchema,
  storyWriterRowSchema,
  tableSqlRowSchema,
} from "./rows";
import {
  blocksTableSchema,
  participantsTableSchema,
  passagesTableSchema,
  pushSubscriptionsTableSchema,
  storiesTableSchema,
  suggestionRequestsTableSchema,
  usersTableSchema,
} from "./tableSchemas";

// Types only: import these with `import type`. Nothing here is ever parsed.

const turnStateSchema = z.custom<TurnState>();

const loadedStorySchema = z.object({
  story: storyRowSchema,
  /** Everyone who ever joined, in turn order. A leaver keeps their row, and their place if they rejoin. */
  participants: z.array(participantRowSchema),
  /** The participants who have not left, in turn order. They hold the turn and fill the cap. */
  activeParticipants: z.array(participantRowSchema),
  /** One past the highest position anyone has held, a leaver's included, so a new one never collides. */
  nextPosition: z.number(),
  /** The stored turn state; `resolveTurn(state, now)` applies any expiry. */
  state: turnStateSchema,
});
export type LoadedStory = z.infer<typeof loadedStorySchema>;

/** A loaded story with its passages, oldest first. */
const loadedStoryWithPassagesSchema = z.object({
  loaded: loadedStorySchema,
  passages: z.array(passageRowSchema),
});
export type LoadedStoryWithPassages = z.infer<typeof loadedStoryWithPassagesSchema>;

/** What the list of one user's stories is built from. */
const myStoryRowsSchema = z.object({
  stories: z.array(myStoryRowSchema),
  /** The writers of those stories who have not left, in turn order. */
  writers: z.array(storyWriterRowSchema),
  passages: z.array(storyPassageRowSchema),
});
export type MyStoryRows = z.infer<typeof myStoryRowsSchema>;

const newParticipantSchema = participantsTableSchema.pick({
  id: true,
  position: true,
  userId: true,
});
export type NewParticipant = z.infer<typeof newParticipantSchema>;

/** The name a user takes when they start or join their first story. */
const newDisplayNameSchema = z.object({
  displayName: usersTableSchema.shape.displayName.unwrap(),
  displayNameKey: usersTableSchema.shape.displayNameKey.unwrap(),
});
export type NewDisplayName = z.infer<typeof newDisplayNameSchema>;

const createStoryInputSchema = z.object({
  storyId: storiesTableSchema.shape.id,
  now: z.number(),
  /** `newStoryState()`. */
  state: turnStateSchema,
  creator: newParticipantSchema,
  /** Null when the creator's user already has a name. */
  displayName: newDisplayNameSchema.nullable(),
  opening: passagesTableSchema.pick({ id: true, text: true }),
});
export type CreateStoryInput = z.infer<typeof createStoryInputSchema>;

const appendPassageInputSchema = z.object({
  storyId: storiesTableSchema.shape.id,
  loadedVersion: z.number(),
  next: turnStateSchema,
  passage: passagesTableSchema
    .pick({ id: true, authorId: true, text: true, createdAt: true })
    .extend({ startsParagraph: z.boolean() }),
});
export type AppendPassageInput = z.infer<typeof appendPassageInputSchema>;

const leaveStoryInputSchema = z.object({
  storyId: storiesTableSchema.shape.id,
  loadedVersion: z.number(),
  next: turnStateSchema,
  participantId: participantsTableSchema.shape.id,
  leftAt: participantsTableSchema.shape.leftAt.unwrap(),
});
export type LeaveStoryInput = z.infer<typeof leaveStoryInputSchema>;

const rejoinStoryInputSchema = z.object({
  storyId: storiesTableSchema.shape.id,
  loadedVersion: z.number(),
  next: turnStateSchema,
  participantId: participantsTableSchema.shape.id,
  /** The place at the end of the turn order: `LoadedStory.nextPosition`. */
  position: participantsTableSchema.shape.position,
});
export type RejoinStoryInput = z.infer<typeof rejoinStoryInputSchema>;

const addParticipantInputSchema = z.object({
  storyId: storiesTableSchema.shape.id,
  loadedVersion: z.number(),
  next: turnStateSchema,
  participant: newParticipantSchema,
  /** Null when the joiner's user already has a name. */
  displayName: newDisplayNameSchema.nullable(),
  joinedAt: participantsTableSchema.shape.joinedAt,
});
export type AddParticipantInput = z.infer<typeof addParticipantInputSchema>;

const newAccountUserSchema = usersTableSchema
  .pick({ id: true, createdAt: true })
  .extend({ clerkUserId: usersTableSchema.shape.clerkUserId.unwrap() });
export type NewAccountUser = z.infer<typeof newAccountUserSchema>;

const newAnonymousUserSchema = usersTableSchema
  .pick({ id: true, createdAt: true })
  .extend({ browserTokenHash: usersTableSchema.shape.browserTokenHash.unwrap() });
export type NewAnonymousUser = z.infer<typeof newAnonymousUserSchema>;

const newPushSubscriptionSchema = pushSubscriptionsTableSchema.pick({
  endpoint: true,
  p256dh: true,
  auth: true,
  userId: true,
  createdAt: true,
});
export type NewPushSubscription = z.infer<typeof newPushSubscriptionSchema>;

const newBlockSchema = blocksTableSchema.pick({
  id: true,
  userId: true,
  blockedUserId: true,
  createdAt: true,
});
export type NewBlock = z.infer<typeof newBlockSchema>;

const createdBlockSchema = z.object({
  /** The block's ID: the existing block's when the pair was already blocked. */
  id: blocksTableSchema.shape.id,
  created: z.boolean(),
});
export type CreatedBlock = z.infer<typeof createdBlockSchema>;

const suggestionReservationSchema = suggestionRequestsTableSchema
  .pick({ id: true, participantId: true })
  .extend({
    now: z.number(),
    /** A request counts against the limit while it is newer than `now - windowMs`. */
    windowMs: z.number(),
    limit: z.number(),
  });
export type SuggestionReservation = z.infer<typeof suggestionReservationSchema>;

/** What the generated database reference is rendered from: flat rows read from the database. */
const databaseDocInputSchema = z.object({
  columns: z.array(databaseColumnRowSchema),
  foreignKeys: z.array(foreignKeyRowSchema),
  indexes: z.array(indexRowSchema),
  tableSql: z.array(tableSqlRowSchema),
});
export type DatabaseDocInput = z.infer<typeof databaseDocInputSchema>;
