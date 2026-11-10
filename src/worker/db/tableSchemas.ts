// Stryker disable StringLiteral,ObjectLiteral: descriptions and column lists are documentation, checked by the description test and the drift test
import { z } from "zod";

import { storyIdSchema } from "../../shared/api";

const countSchema = z.number().int().nonnegative();
const idSchema = z.string().min(1);

export const storiesTableSchema = z
  .object({
    id: storyIdSchema.meta({
      description:
        "Five-character story ID of lowercase letters and digits, also its URL path (/<id>).",
    }),
    createdAt: countSchema.meta({ description: "When the story was created, in epoch ms." }),
    currentPosition: countSchema
      .nullable()
      .meta({ description: "Position of the turn holder; null while the story is waiting." }),
    turnStartedAt: countSchema.nullable().meta({
      description: "When the current turn began, in epoch ms; null while the story is waiting.",
    }),
    turnVersion: countSchema.meta({
      description:
        "Starts at 0 and goes up by one on each contribution, skip, expired window, join, rejoin and leave.",
    }),
    lastContributorPosition: countSchema.nullable().meta({
      description:
        "Position of the last contributor, whom the turn passes over. Set from the opening on, so never null in practice.",
    }),
  })
  .meta({
    description:
      "One row per story. The turn fields hold the turn as last saved: an expired window moves the turn only on the next write, so read them through resolveTurn. A waiting story has no turn holder, so its current position and turn start are null.",
  });

export const participantsTableSchema = z
  .object({
    id: idSchema.meta({ description: "Opaque ID of the participant." }),
    storyId: storyIdSchema.meta({ description: "The story the participant joined." }),
    position: countSchema.meta({
      description:
        "Place in the turn order, unique in the story; a leaver keeps theirs, and a rejoin gets a new last one.",
    }),
    userId: idSchema.meta({ description: "The user this participant belongs to." }),
    joinedAt: countSchema.meta({
      description: "When the participant first joined, in epoch ms; a rejoin keeps it.",
    }),
    leftAt: countSchema.nullable().meta({
      description: "When the participant left the story, in epoch ms; null while they are in it.",
    }),
  })
  .meta({
    description:
      "One row per user who joins a story. A leaver's row stays, so the story keeps its turn order and the user keeps their place if they rejoin. After a merge, a user can also hold a left row in a story they are in.",
  });

export const passagesTableSchema = z
  .object({
    id: idSchema.meta({ description: "Opaque ID of the passage." }),
    storyId: storyIdSchema.meta({ description: "The story the passage belongs to." }),
    authorId: idSchema.meta({ description: "The user who wrote it, its author." }),
    seq: countSchema.meta({
      description: "Place in the story, 1 for the opening, unique within the story.",
    }),
    text: z.string().meta({ description: "The text of the passage." }),
    startsParagraph: z.union([z.literal(0), z.literal(1)]).meta({
      description: "1 if the passage begins a new paragraph, 0 if it continues the last one.",
    }),
    createdAt: countSchema.meta({ description: "When the passage was written, in epoch ms." }),
  })
  .meta({
    description:
      "Every passage of a story. Append-only: the app never edits or deletes the text, and author_id changes only when two users merge.",
  });

export const suggestionRequestsTableSchema = z
  .object({
    id: idSchema.meta({ description: "Opaque ID of the request." }),
    participantId: idSchema.meta({ description: "The participant who asked for suggestions." }),
    createdAt: countSchema.meta({ description: "When the request was made, in epoch ms." }),
  })
  .meta({
    description:
      "One row per suggestion request. Rows newer than SUGGESTION_WINDOW_MS count towards the participant's SUGGESTION_LIMIT. The app deletes a row only when the AI provider errors; a timeout or unusable reply still counts.",
  });

export const usersTableSchema = z
  .object({
    id: idSchema.meta({ description: "Opaque ID of the user." }),
    clerkUserId: z.string().nullable().meta({
      description: "Clerk user ID of the user's account; null for an anonymous user.",
    }),
    browserTokenHash: z.string().nullable().meta({
      description: "Hex SHA-256 hash of the device token; null for an account user.",
    }),
    displayName: z.string().nullable().meta({
      description:
        "Name shown beside the user's passages in every story; null until the user starts or joins a story.",
    }),
    displayNameKey: z.string().nullable().meta({
      description:
        "The display name trimmed, NFKC-normalised and case-folded; unique across users. Null exactly when the display name is.",
    }),
    createdAt: countSchema.meta({ description: "When the user was created, in epoch ms." }),
  })
  .meta({
    description:
      "One row per user, found by the hash of its device token or by its Clerk user ID. Passages, participants and push subscriptions belong to a user, and so does the display name.",
  });

export const pushSubscriptionsTableSchema = z
  .object({
    endpoint: z.string().meta({ description: "Web Push endpoint of the subscription." }),
    userId: idSchema.meta({ description: "The user the subscription belongs to." }),
    p256dh: z.string().meta({
      description: "The browser's public key, used to encrypt each message, base64url.",
    }),
    auth: z.string().meta({
      description: "Authentication secret used to encrypt each message, base64url.",
    }),
    createdAt: countSchema.meta({
      description: "When the subscription was first stored, in epoch ms.",
    }),
  })
  .meta({
    description:
      "A browser's Web Push subscription, one per push service endpoint. It belongs to a user, not a story, and covers every story the user is in.",
  });

/** Every table schema, under its SQL table name. */
export const TABLE_SCHEMAS = {
  stories: storiesTableSchema,
  participants: participantsTableSchema,
  passages: passagesTableSchema,
  suggestion_requests: suggestionRequestsTableSchema,
  users: usersTableSchema,
  push_subscriptions: pushSubscriptionsTableSchema,
};
