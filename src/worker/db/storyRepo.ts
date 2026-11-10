/**
 * All SQL. D1 has no interactive transactions, so each write is one `db.batch()` (atomic) whose
 * statements all test the same condition: the story is still at the `turn_version` the caller
 * loaded. Participants and passages only change together with that version, so a write that
 * loses a race changes nothing and reports `false`; the route answers 409 `stale_turn`.
 * docs/turn-persistence.md says why the guard uses the loaded version.
 */
import { z } from "zod";

import type { TurnState } from "../../shared/turnOrder";
import { MAX_PARTICIPANTS } from "../../shared/validation";
import {
  myStoryRowSchema,
  openingRowSchema,
  participantRowSchema,
  passageRowSchema,
  storyPassageRowSchema,
  storyRowSchema,
  storyWriterRowSchema,
  type ParticipantRow,
  type StoryRow,
} from "./rows";
import type {
  AddParticipantInput,
  AppendPassageInput,
  CreateStoryInput,
  LeaveStoryInput,
  LoadedStory,
  LoadedStoryWithPassages,
  MyStoryRows,
  NewDisplayName,
  NewParticipant,
  RejoinStoryInput,
} from "./typeSchemas";
import { findUserByDisplayNameKey } from "./userRepo";

/** The two D1 methods the repo uses, so a test can hand it a stand-in. */
export type Db = Pick<D1Database, "prepare" | "batch">;

/** `id_taken`: the story ID is already stored. `name_taken`: another user holds the display name. */
export type CreateStoryResult = "created" | "id_taken" | "name_taken";

/** `refused`: the story moved on or is full. `name_taken`: another user holds the display name. */
export type AddParticipantResult = "saved" | "refused" | "name_taken";

const STORY_COLUMNS = `id, created_at AS createdAt, current_position AS currentPosition,
  turn_started_at AS turnStartedAt, turn_version AS turnVersion,
  last_contributor_position AS lastContributorPosition`;

const PARTICIPANT_COLUMNS = `p.id, u.display_name AS displayName, p.position, p.user_id AS userId,
  p.left_at AS leftAt`;

/** The story and its participants from one snapshot, or null for an unknown ID. */
export async function loadStory(db: Db, storyId: string): Promise<LoadedStory | null> {
  const results = await db.batch([selectStory(db, storyId), selectParticipants(db, storyId)]);

  return toLoadedStory(
    rowsAt(results, 0, z.array(storyRowSchema)),
    rowsAt(results, 1, z.array(participantRowSchema)),
  );
}

/** As `loadStory`, plus the passages oldest first, all from one snapshot. */
export async function loadStoryWithPassages(
  db: Db,
  storyId: string,
): Promise<LoadedStoryWithPassages | null> {
  const results = await db.batch([
    selectStory(db, storyId),
    selectParticipants(db, storyId),
    db
      .prepare(
        `SELECT p.id, p.author_id AS authorId, u.display_name AS authorName, p.text,
           p.starts_paragraph AS startsParagraph, p.created_at AS createdAt
         FROM passages p JOIN users u ON u.id = p.author_id
         WHERE p.story_id = ? ORDER BY p.seq`,
      )
      .bind(storyId),
  ]);

  const loaded = toLoadedStory(
    rowsAt(results, 0, z.array(storyRowSchema)),
    rowsAt(results, 1, z.array(participantRowSchema)),
  );

  return loaded === null
    ? null
    : { loaded, passages: rowsAt(results, 2, z.array(passageRowSchema)) };
}

// The stories a user is in: the ones where a participant row of theirs has not left.
const STORIES_OF_USER = `SELECT story_id FROM participants
  WHERE user_id = ? AND left_at IS NULL`;

/** The stories a user is in and has not left, from one snapshot, in no particular order. */
export async function loadMyStories(db: Db, userId: string): Promise<MyStoryRows> {
  const results = await db.batch([
    db
      .prepare(
        `SELECT ${STORY_COLUMNS},
           (SELECT me.position FROM participants me
            WHERE me.story_id = stories.id AND me.user_id = ? AND me.left_at IS NULL)
             AS myPosition
         FROM stories WHERE id IN (${STORIES_OF_USER})`,
      )
      .bind(userId, userId),
    db
      .prepare(
        `SELECT p.story_id AS storyId, u.display_name AS displayName, p.position
         FROM participants p JOIN users u ON u.id = p.user_id
         WHERE p.left_at IS NULL AND p.story_id IN (${STORIES_OF_USER})
         ORDER BY p.story_id, p.position`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT p.story_id AS storyId, MAX(p.created_at) AS latestAt,
           (SELECT o.text FROM passages o WHERE o.story_id = p.story_id AND o.seq = 1)
             AS opening
         FROM passages p WHERE p.story_id IN (${STORIES_OF_USER})
         GROUP BY p.story_id`,
      )
      .bind(userId),
  ]);

  return {
    stories: rowsAt(results, 0, z.array(myStoryRowSchema)),
    writers: rowsAt(results, 1, z.array(storyWriterRowSchema)),
    passages: rowsAt(results, 2, z.array(storyPassageRowSchema)),
  };
}

/**
 * Inserts a story with its creator and opening passage, and gives the creator's user their display
 * name when `displayName` is set. Nothing is written for `id_taken`, so the caller retries with a
 * new ID, or for `name_taken`.
 */
export async function createStory(db: Db, input: CreateStoryInput): Promise<CreateStoryResult> {
  const { storyId, now, state, creator, displayName, opening } = input;

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO stories (id, created_at, current_position, turn_started_at, turn_version,
             last_contributor_position) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          storyId,
          now,
          state.currentPosition,
          state.turnStartedAt,
          state.turnVersion,
          state.lastContributorPosition,
        ),
      insertParticipant(db, storyId, state.turnVersion, creator, now),
      takeDisplayName(db, storyId, creator, displayName),
      db
        .prepare(
          `INSERT INTO passages (id, story_id, author_id, seq, text, starts_paragraph, created_at)
           VALUES (?, ?, ?, 1, ?, 1, ?)`,
        )
        .bind(opening.id, storyId, creator.userId, opening.text, now),
    ]);
  } catch (error) {
    // The batch is atomic, so a failed one leaves nothing behind. If the ID is already stored,
    // the story insert collided; if another user holds the name, the name update did. Any other
    // failure is not ours to swallow. Asking the database avoids depending on the wording of the
    // driver's constraint error.
    if (await storyExists(db, storyId)) {
      return "id_taken";
    }
    if (await isHeldByAnotherUser(db, displayName, creator.userId)) {
      return "name_taken";
    }
    throw error;
  }

  return "created";
}

/** Appends a passage and saves the turn that follows it. False when the story moved on. */
export async function appendPassage(db: Db, input: AppendPassageInput): Promise<boolean> {
  const { storyId, loadedVersion, next, passage } = input;

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO passages (id, story_id, author_id, seq, text, starts_paragraph, created_at)
         SELECT ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM passages WHERE story_id = ?),
           ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)`,
      )
      .bind(
        passage.id,
        storyId,
        passage.authorId,
        storyId,
        passage.text,
        passage.startsParagraph ? 1 : 0,
        passage.createdAt,
        storyId,
        loadedVersion,
      ),
    updateTurn(db, storyId, loadedVersion, next),
  ]);

  return changesAt(results, 1) === 1;
}

/** Saves a new turn state, for a skip. False when the story moved on. */
export async function saveTurn(
  db: Db,
  storyId: string,
  loadedVersion: number,
  next: TurnState,
): Promise<boolean> {
  const result = await updateTurn(db, storyId, loadedVersion, next).run();

  return result.meta.changes === 1;
}

/**
 * Adds a participant, gives their user the display name when `displayName` is set, and saves the
 * turn state their join produced. `refused` when the story moved on or already has
 * MAX_PARTICIPANTS; nothing is written then, so the route tells the two apart.
 */
export async function addParticipant(
  db: Db,
  input: AddParticipantInput,
): Promise<AddParticipantResult> {
  const { storyId, loadedVersion, next, participant, displayName, joinedAt } = input;

  try {
    const results = await db.batch([
      insertParticipant(db, storyId, loadedVersion, participant, joinedAt),
      takeDisplayName(db, storyId, participant, displayName),
      // The insert can refuse alone (a full story), and the turn must not move without a joiner.
      updateTurn(db, storyId, loadedVersion, next, participant.id),
    ]);

    return changesAt(results, 2) === 1 ? "saved" : "refused";
  } catch (error) {
    // The batch is atomic, so a failed one leaves nothing behind. See `createStory`.
    if (await isHeldByAnotherUser(db, displayName, participant.userId)) {
      return "name_taken";
    }
    throw error;
  }
}

/**
 * Marks a participant as having left and saves the turn that follows. False when the story moved
 * on. Both statements test the loaded version, so they succeed or fail together.
 */
export async function leaveStory(db: Db, input: LeaveStoryInput): Promise<boolean> {
  const { storyId, loadedVersion, next, participantId, leftAt } = input;

  const results = await db.batch([
    db
      .prepare(
        `UPDATE participants SET left_at = ?
         WHERE id = ? AND left_at IS NULL
           AND EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)`,
      )
      .bind(leftAt, participantId, storyId, loadedVersion),
    updateTurn(db, storyId, loadedVersion, next),
  ]);

  return changesAt(results, 1) === 1;
}

/**
 * Brings a participant who left back into the story, at the end of the turn order, and saves the
 * turn that follows. False when the story moved on or already has MAX_PARTICIPANTS; nothing is
 * written then, so the route tells the two apart.
 */
export async function rejoinStory(db: Db, input: RejoinStoryInput): Promise<boolean> {
  const { storyId, loadedVersion, next, participantId, position } = input;

  const results = await db.batch([
    db
      .prepare(
        `UPDATE participants SET left_at = NULL, position = ?
         WHERE id = ? AND left_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)
           AND (SELECT COUNT(*) FROM participants WHERE story_id = ? AND left_at IS NULL) < ?`,
      )
      .bind(position, participantId, storyId, loadedVersion, storyId, MAX_PARTICIPANTS),
    // The update can refuse alone (a full story), and the turn must not move without the rejoiner.
    updateTurn(db, storyId, loadedVersion, next, participantId),
  ]);

  return changesAt(results, 1) === 1;
}

/** The text of the story's first passage. Every story has one, so a missing one is a bug. */
export async function loadOpeningText(db: Db, storyId: string): Promise<string> {
  const result = await db
    .prepare("SELECT text FROM passages WHERE story_id = ? AND seq = 1")
    .bind(storyId)
    .all();
  const [row] = z.array(openingRowSchema).parse(result.results);
  if (row === undefined) {
    throw new Error(`Story ${storyId} has no opening passage`);
  }

  return row.text;
}

function toLoadedStory(stories: StoryRow[], participants: ParticipantRow[]): LoadedStory | null {
  const [story] = stories;
  if (story === undefined) {
    return null;
  }

  const activeParticipants = participants.filter((participant) => participant.leftAt === null);
  const state = toTurnState(
    story,
    activeParticipants.map((participant) => participant.position),
  );
  const nextPosition = Math.max(...participants.map((participant) => participant.position)) + 1;

  return { story, participants, activeParticipants, nextPosition, state };
}

/** The stored turn state of a story whose writers, the ones who have not left, hold `activePositions`. */
export function toTurnState(story: StoryRow, activePositions: readonly number[]): TurnState {
  const base = {
    turnVersion: story.turnVersion,
    lastContributorPosition: story.lastContributorPosition,
    participantPositions: activePositions,
  };

  return story.currentPosition === null
    ? { ...base, currentPosition: null, turnStartedAt: null }
    : { ...base, currentPosition: story.currentPosition, turnStartedAt: story.turnStartedAt };
}

async function storyExists(db: Db, storyId: string): Promise<boolean> {
  const result = await db.prepare("SELECT 1 FROM stories WHERE id = ?").bind(storyId).all();

  return result.results.length > 0;
}

function selectStory(db: Db, storyId: string): D1PreparedStatement {
  return db.prepare(`SELECT ${STORY_COLUMNS} FROM stories WHERE id = ?`).bind(storyId);
}

function selectParticipants(db: Db, storyId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT ${PARTICIPANT_COLUMNS} FROM participants p JOIN users u ON u.id = p.user_id
       WHERE p.story_id = ? ORDER BY p.position`,
    )
    .bind(storyId);
}

// Inserts only while the story is still at `loadedVersion` and has room. The version guard already
// serialises joins (each bumps it); the count is a second defence that holds even for a caller
// with a current version.
function insertParticipant(
  db: Db,
  storyId: string,
  loadedVersion: number,
  participant: NewParticipant,
  joinedAt: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO participants (id, story_id, position, user_id, joined_at)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)
         AND (SELECT COUNT(*) FROM participants WHERE story_id = ? AND left_at IS NULL) < ?`,
    )
    .bind(
      participant.id,
      storyId,
      participant.position,
      participant.userId,
      joinedAt,
      storyId,
      loadedVersion,
      storyId,
      MAX_PARTICIPANTS,
    );
}

// Gives the participant's user their display name, once the participant row exists. A null name,
// or a user who already has one, changes nothing, so the batch has the same shape either way. The
// unique index on the key fails the whole batch when another user holds the name.
function takeDisplayName(
  db: Db,
  storyId: string,
  participant: NewParticipant,
  displayName: NewDisplayName | null,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE users SET display_name = ?, display_name_key = ?
       WHERE id = ? AND display_name IS NULL
         AND EXISTS (SELECT 1 FROM participants WHERE id = ? AND story_id = ?)`,
    )
    .bind(
      displayName?.displayName ?? null,
      displayName?.displayNameKey ?? null,
      participant.userId,
      participant.id,
      storyId,
    );
}

/**
 * Whether a user other than `userId` holds `displayName`. The user who already holds it is not
 * counted: two overlapping requests from one unnamed user both send the name, and the first to
 * write gives it to them. `userId` is null for a requester who has no user yet.
 */
export async function isHeldByAnotherUser(
  db: Db,
  displayName: NewDisplayName | null,
  userId: string | null,
): Promise<boolean> {
  if (displayName === null) {
    return false;
  }

  const holder = await findUserByDisplayNameKey(db, displayName.displayNameKey);

  return holder !== null && holder.id !== userId;
}

// With `requiredParticipantId`, saves only if that participant is in the story (row exists, not left).
function updateTurn(
  db: Db,
  storyId: string,
  loadedVersion: number,
  next: TurnState,
  requiredParticipantId = "",
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE stories SET current_position = ?, turn_started_at = ?, turn_version = ?,
         last_contributor_position = ?
       WHERE id = ? AND turn_version = ?
         AND (? = '' OR EXISTS (SELECT 1 FROM participants WHERE id = ? AND left_at IS NULL))`,
    )
    .bind(
      next.currentPosition,
      next.turnStartedAt,
      next.turnVersion,
      next.lastContributorPosition,
      storyId,
      loadedVersion,
      requiredParticipantId,
      requiredParticipantId,
    );
}

function rowsAt<T>(results: D1Result[], index: number, schema: z.ZodType<T>): T {
  const result = results[index];
  if (result === undefined) {
    throw new Error(`D1 batch returned no result at index ${String(index)}`);
  }

  return schema.parse(result.results);
}

function changesAt(results: D1Result[], index: number): number {
  const result = results[index];
  if (result === undefined) {
    throw new Error(`D1 batch returned no result at index ${String(index)}`);
  }

  return result.meta.changes;
}
