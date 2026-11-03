/**
 * All SQL. D1 has no interactive transactions, so each write is one `db.batch()` (atomic) whose
 * statements all test the same condition: the story is still at the `turn_version` the caller
 * loaded. Participants and contributions only change together with that version, so a write that
 * loses a race changes nothing and reports `false`; the route answers 409 `stale_turn`.
 * docs/turn-persistence.md says why the guard uses the loaded version.
 */
import { z } from "zod";

import type { TurnState } from "../../shared/turnOrder";
import { MAX_PARTICIPANTS } from "../../shared/validation";
import {
  contributionRowSchema,
  myStoryRowSchema,
  participantRowSchema,
  storyPassageRowSchema,
  storyRowSchema,
  storyWriterRowSchema,
  type ContributionRow,
  type MyStoryRow,
  type ParticipantRow,
  type StoryPassageRow,
  type StoryRow,
  type StoryWriterRow,
} from "./rows";

/** The two D1 methods the repo uses, so a test can hand it a stand-in. */
export type Db = Pick<D1Database, "prepare" | "batch">;

export interface LoadedStory {
  story: StoryRow;
  /** Everyone who ever joined, in rotation order. A leaver keeps their row, and their name stays taken. */
  participants: ParticipantRow[];
  /** The participants who have not left, in rotation order. They hold the turn and fill the cap. */
  activeParticipants: ParticipantRow[];
  /** One past the highest position anyone has held, a leaver's included, so a new one never collides. */
  nextPosition: number;
  /** The stored turn state; `resolveTurn(state, now)` applies any expiry. */
  state: TurnState;
}

/** What the list of one browser's stories is built from. */
export interface MyStoryRows {
  stories: MyStoryRow[];
  /** The writers of those stories who have not left, in rotation order. */
  writers: StoryWriterRow[];
  passages: StoryPassageRow[];
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
  contribution: {
    id: string;
    participantId: string;
    text: string;
    startsParagraph: boolean;
    createdAt: number;
  };
}

export interface LeaveStoryInput {
  storyId: string;
  loadedVersion: number;
  next: TurnState;
  participantId: string;
  leftAt: number;
}

export interface RejoinStoryInput {
  storyId: string;
  loadedVersion: number;
  next: TurnState;
  participantId: string;
  /** The place at the end of the rotation: `LoadedStory.nextPosition`. */
  position: number;
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
  position, browser_token_hash AS browserTokenHash, left_at AS leftAt`;

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
           c.starts_paragraph AS startsParagraph, c.created_at AS createdAt
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

// The stories a browser is in: the ones where a participant row with its token hash has not left.
const STORIES_OF_BROWSER = `SELECT story_id FROM participants
  WHERE browser_token_hash = ? AND left_at IS NULL`;

/** The stories a browser is in and has not left, from one snapshot, in no particular order. */
export async function loadMyStories(db: Db, browserTokenHash: string): Promise<MyStoryRows> {
  const results = await db.batch([
    db
      .prepare(
        `SELECT ${STORY_COLUMNS},
           (SELECT me.position FROM participants me
            WHERE me.story_id = stories.id AND me.browser_token_hash = ? AND me.left_at IS NULL)
             AS myPosition
         FROM stories WHERE id IN (${STORIES_OF_BROWSER})`,
      )
      .bind(browserTokenHash, browserTokenHash),
    db
      .prepare(
        `SELECT story_id AS storyId, display_name AS displayName, position FROM participants
         WHERE left_at IS NULL AND story_id IN (${STORIES_OF_BROWSER})
         ORDER BY story_id, position`,
      )
      .bind(browserTokenHash),
    db
      .prepare(
        `SELECT c.story_id AS storyId, MAX(c.created_at) AS latestAt,
           (SELECT o.text FROM contributions o WHERE o.story_id = c.story_id AND o.seq = 1)
             AS opening
         FROM contributions c WHERE c.story_id IN (${STORIES_OF_BROWSER})
         GROUP BY c.story_id`,
      )
      .bind(browserTokenHash),
  ]);

  return {
    stories: rowsAt(results, 0, z.array(myStoryRowSchema)),
    writers: rowsAt(results, 1, z.array(storyWriterRowSchema)),
    passages: rowsAt(results, 2, z.array(storyPassageRowSchema)),
  };
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
          `INSERT INTO contributions (id, story_id, participant_id, seq, text, starts_paragraph,
             created_at) VALUES (?, ?, ?, 1, ?, 1, ?)`,
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
        `INSERT INTO contributions (id, story_id, participant_id, seq, text, starts_paragraph,
           created_at)
         SELECT ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM contributions WHERE story_id = ?),
           ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)`,
      )
      .bind(
        contribution.id,
        storyId,
        contribution.participantId,
        storyId,
        contribution.text,
        contribution.startsParagraph ? 1 : 0,
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

/**
 * Adds a participant and saves the turn state their join produced. False when the story moved on
 * or already has MAX_PARTICIPANTS; nothing is written then, so the route tells the two apart.
 */
export async function addParticipant(db: Db, input: AddParticipantInput): Promise<boolean> {
  const { storyId, loadedVersion, next, participant, joinedAt } = input;

  const results = await db.batch([
    insertParticipant(db, storyId, loadedVersion, participant, joinedAt),
    // The insert can refuse alone (a full story), and the turn must not move without a joiner.
    updateTurn(db, storyId, loadedVersion, next, participant.id),
  ]);

  return changesAt(results, 1) === 1;
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
 * Brings a participant who left back into the story, at the end of the rotation, and saves the
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
    .prepare("SELECT text FROM contributions WHERE story_id = ? AND seq = 1")
    .bind(storyId)
    .all();
  const [row] = z.array(z.object({ text: z.string() })).parse(result.results);
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
    .prepare(`SELECT ${PARTICIPANT_COLUMNS} FROM participants WHERE story_id = ? ORDER BY position`)
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
      `INSERT INTO participants (id, story_id, display_name, display_name_key, position,
         browser_token_hash, joined_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM stories WHERE id = ? AND turn_version = ?)
         AND (SELECT COUNT(*) FROM participants WHERE story_id = ? AND left_at IS NULL) < ?`,
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
      storyId,
      MAX_PARTICIPANTS,
    );
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
