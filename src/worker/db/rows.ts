import { z } from "zod";

import {
  participantsTableSchema,
  passagesTableSchema,
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

/** A participant with their user's display name, which every participant's user has. */
export const participantRowSchema = participantsTableSchema
  .pick({ id: true, position: true, userId: true, leftAt: true })
  .extend({ displayName: usersTableSchema.shape.displayName.unwrap() });
export type ParticipantRow = z.infer<typeof participantRowSchema>;

/** A passage with its author's name, as the story view shows it. */
export const passageRowSchema = passagesTableSchema
  .pick({ id: true, authorId: true, text: true, createdAt: true })
  .extend({
    authorName: usersTableSchema.shape.displayName.unwrap(),
    startsParagraph: passagesTableSchema.shape.startsParagraph.transform((flag) => flag === 1),
  });
export type PassageRow = z.infer<typeof passageRowSchema>;

/** A story the caller is in, with the position they hold in its turn order. */
export const myStoryRowSchema = z.intersection(
  storyRowSchema,
  z.object({ myPosition: participantsTableSchema.shape.position }),
);
export type MyStoryRow = z.infer<typeof myStoryRowSchema>;

/** One writer who has not left a story, for the list of a user's stories. */
export const storyWriterRowSchema = participantsTableSchema
  .pick({ storyId: true, position: true })
  .extend({ displayName: usersTableSchema.shape.displayName.unwrap() });
export type StoryWriterRow = z.infer<typeof storyWriterRowSchema>;

/** A story's first passage and when its newest passage was written. */
export const storyPassageRowSchema = passagesTableSchema.pick({ storyId: true }).extend({
  opening: passagesTableSchema.shape.text,
  latestAt: passagesTableSchema.shape.createdAt,
});
export type StoryPassageRow = z.infer<typeof storyPassageRowSchema>;

export const openingRowSchema = passagesTableSchema.pick({ text: true });

export const participantStoryIdRowSchema = participantsTableSchema.pick({ storyId: true });

export const userRowSchema = usersTableSchema.pick({
  id: true,
  displayName: true,
  displayNameKey: true,
});
export type UserRow = z.infer<typeof userRowSchema>;

/** What a push needs to reach one browser. */
export const pushSubscriptionRowSchema = pushSubscriptionsTableSchema.pick({
  endpoint: true,
  p256dh: true,
  auth: true,
});
export type PushSubscriptionRow = z.infer<typeof pushSubscriptionRowSchema>;

/** One column of a table in the migrated database, as `pragma_table_info` reports it. */
export const databaseColumnRowSchema = z.object({
  tableName: z.string(),
  cid: z.number().int().nonnegative(),
  name: z.string(),
  /** The declared SQLite type, such as `INTEGER` or `TEXT`. */
  type: z.string(),
  notNull: z.union([z.literal(0), z.literal(1)]),
  defaultValue: z.string().nullable(),
  /** 0 when the column is not in the primary key, else its 1-based position in it. */
  primaryKey: z.number().int().nonnegative(),
});
export type DatabaseColumnRow = z.infer<typeof databaseColumnRowSchema>;

/** One foreign key column, as `pragma_foreign_key_list` reports it. */
export const foreignKeyRowSchema = z.object({
  tableName: z.string(),
  /** The table the key points at. */
  parentTable: z.string(),
  /** The column of `tableName` that holds the key. */
  fromColumn: z.string(),
  /** 0 for the only or first column of the key; above 0 only in a composite key. */
  seq: z.number().int().nonnegative(),
});
export type ForeignKeyRow = z.infer<typeof foreignKeyRowSchema>;

/** One column of one index, as `pragma_index_xinfo` reports it. */
export const indexColumnRowSchema = z.object({
  tableName: z.string(),
  name: z.string(),
  unique: z.union([z.literal(0), z.literal(1)]),
  /** `c` for CREATE INDEX, `u` for a UNIQUE constraint, `pk` for the primary key. */
  origin: z.enum(["c", "u", "pk"]),
  partial: z.union([z.literal(0), z.literal(1)]),
  /** The CREATE INDEX statement; null for an index SQLite makes by itself. */
  sql: z.string().nullable(),
  seqno: z.number().int().nonnegative(),
  /** Null for an expression such as `lower(name)`. */
  columnName: z.string().nullable(),
  descending: z.union([z.literal(0), z.literal(1)]),
  collation: z.string(),
});
export type IndexColumnRow = z.infer<typeof indexColumnRowSchema>;

/** One index of a table, with its columns in order. */
export const indexRowSchema = indexColumnRowSchema
  .omit({ seqno: true, columnName: true, descending: true, collation: true })
  .extend({ columns: z.array(indexColumnRowSchema.shape.columnName.unwrap()) });
export type IndexRow = z.infer<typeof indexRowSchema>;

/** The CREATE TABLE statement SQLite kept for a table. */
export const tableSqlRowSchema = z.object({
  tableName: z.string(),
  sql: z.string(),
});
export type TableSqlRow = z.infer<typeof tableSqlRowSchema>;
