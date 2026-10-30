/**
 * All SQL. D1 has no interactive transactions, so each write is one `db.batch()` (atomic) whose
 * statements all test the same condition: the story is still at the `turn_version` the caller
 * loaded. Participants and contributions only change together with that version, so a write that
 * loses a race changes nothing and reports `false`; the route answers 409 `stale_turn`.
 * docs/turn-persistence.md says why the guard uses the loaded version.
 */
import { z } from "zod";

import type { TurnState } from "../../shared/turnOrder";
import {
  contributionRowSchema,
  participantRowSchema,
  storyRowSchema,
  type ContributionRow,
  type ParticipantRow,
  type StoryRow,
} from "./rows";

/** The two D1 methods the repo uses, so a test can hand it a stand-in. */
export type Db = Pick<D1Database, "prepare" | "batch">;

export interface LoadedStory {
  story: StoryRow;
  /** In rotation order. */
  participants: ParticipantRow[];
  /** The stored turn state; `resolveTurn(state, now)` applies any expiry. */
  state: TurnState;
}

export interface NewParticipant {
  id: string;
  displayName: string;
  displayNameKey: string;
  position: number;
  browserTokenHash: string;
}

export interface CreateStoryInput {
  storyId: string;
  now: number;
  /** `newStoryState()`. */
  state: TurnState;
  creator: NewParticipant;
  opening: { id: string; text: string };
}

export interface AppendContributionInput {
  storyId: string;
  loadedVersion: number;
  next: TurnState;
  contribution: { id: string; participantId: string; text: string; createdAt: number };
}

export interface AddParticipantInput {
  storyId: string;
  loadedVersion: number;
  next: TurnState;
  participant: NewParticipant;
  joinedAt: number;
}

const STORY_COLUMNS = `id, created_at AS createdAt, current_position AS currentPosition,
  turn_started_at AS turnStartedAt, turn_version AS turnVersion,
  last_contributor_position AS lastContributorPosition`;

const PARTICIPANT_COLUMNS = `id, display_name AS displayName, display_name_key AS displayNameKey,
  position, browser_token_hash AS browserTokenHash`;

/** The story and its participants from one snapshot, or null for an unknown ID. */
export async function loadStory(db: Db, storyId: string): Promise<LoadedStory | null> {
  const results = await db.batch([selectStory(db, storyId), selectParticipants(db, storyId)]);

  return toLoadedStory(
    rowsAt(results, 0, z.array(storyRowSchema)),
    rowsAt(results, 1, z.array(participantRowSchema)),
  );
}

/** As `loadStory`, plus the contributions oldest first, all from one snapshot. */
export async function loadStoryWithContributions(
  db: Db,
  storyId: string,
): Promise<{ loaded: LoadedStory; contributions: ContributionRow[] } | null> {
  const results = await db.batch([
    selectStory(db, storyId),
    selectParticipants(db, storyId),
    db
      .prepare(
        `SELECT c.id, c.participant_id AS authorId, p.display_name AS authorName, c.text,
           c.created_at AS createdAt
         FROM contributions c JOIN participants p ON p.id = c.participant_id
         WHERE c.story_id = ? ORDER BY c.seq`,
      )
      .bind(storyId),
  ]);

  const loaded = toLoadedStory(
    rowsAt(results, 0, z.array(storyRowSchema)),
    rowsAt(results, 1, z.array(participantRowSchema)),
  );

  return loaded === null
    ? null
    : { loaded, contributions: rowsAt(results, 2, z.array(contributionRowSchema)) };
}

/**
 * Inserts a story with its creator and opening passage. Returns false when `storyId` is already
 * taken; nothing is written then, so the caller retries with a new ID.
 */
export async function createStory(db: Db, input: CreateStoryInput): Promise<boolean> {
  const { storyId, now, state, creator, opening } = input;

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
      db
        .prepare(
          `INSERT INTO contributions (id, story_id, participant_id, seq, text, created_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(opening.id, storyId, creator.id, opening.text, now),
    ]);
  } catch (error) {
    // The batch is atomic, so a failed one leaves nothing behind. If the ID is already stored,
    // the story insert collided; any other failure is not ours to swallow. Asking the database
    // avoids depending on the wording of the driver's constraint error.
    if (await storyExists(db, storyId)) {
      return false;
    }
    throw error;
  }

  return true;
}

/** Appends a passage and saves the turn that follows it. False when the story moved on. */
export async function appendContribution(db: Db, input: AppendContributionInput): Promise<boolean> {
  const { storyId, loadedVersion, next, contribution } = input;

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO contributions (id, story_id, participant_id, seq, text, created_at)
         SELECT ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM contributions WHERE story_id = ?),
           ?, ?
         WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)`,
      )
      .bind(
        contribution.id,
        storyId,
        contribution.participantId,
        storyId,
        contribution.text,
        contribution.createdAt,
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

/** Adds a participant and saves the turn state their join produced. False when the story moved on. */
export async function addParticipant(db: Db, input: AddParticipantInput): Promise<boolean> {
  const { storyId, loadedVersion, next, participant, joinedAt } = input;

  const results = await db.batch([
    insertParticipant(db, storyId, loadedVersion, participant, joinedAt),
    updateTurn(db, storyId, loadedVersion, next),
  ]);

  return changesAt(results, 1) === 1;
}

function toLoadedStory(stories: StoryRow[], participants: ParticipantRow[]): LoadedStory | null {
  const [story] = stories;
  if (story === undefined) {
    return null;
  }

  const base = {
    turnVersion: story.turnVersion,
    lastContributorPosition: story.lastContributorPosition,
    participantPositions: participants.map((participant) => participant.position),
  };
  const state: TurnState =
    story.currentPosition === null
      ? { ...base, currentPosition: null, turnStartedAt: null }
      : { ...base, currentPosition: story.currentPosition, turnStartedAt: story.turnStartedAt };

  return { story, participants, state };
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
    .prepare(`SELECT ${PARTICIPANT_COLUMNS} FROM participants WHERE story_id = ? ORDER BY position`)
    .bind(storyId);
}

// Inserts only while the story is still at `loadedVersion`.
function insertParticipant(
  db: Db,
  storyId: string,
  loadedVersion: number,
  participant: NewParticipant,
  joinedAt: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO participants (id, story_id, display_name, display_name_key, position,
         browser_token_hash, joined_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)`,
    )
    .bind(
      participant.id,
      storyId,
      participant.displayName,
      participant.displayNameKey,
      participant.position,
      participant.browserTokenHash,
      joinedAt,
      storyId,
      loadedVersion,
    );
}

function updateTurn(
  db: Db,
  storyId: string,
  loadedVersion: number,
  next: TurnState,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE stories SET current_position = ?, turn_started_at = ?, turn_version = ?,
         last_contributor_position = ?
       WHERE id = ? AND turn_version = ?`,
    )
    .bind(
      next.currentPosition,
      next.turnStartedAt,
      next.turnVersion,
      next.lastContributorPosition,
      storyId,
      loadedVersion,
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
