import { z } from "zod";

import { blockRowSchema, type BlockRow } from "./rows";
import type { Db } from "./storyRepo";
import type { CreatedBlock, NewBlock } from "./typeSchemas";

/**
 * Blocks `blockedUserId` for `userId`. When the pair is already blocked, nothing is written and
 * the existing block's ID is returned, so `input.id` is not stored.
 * The insert and the read run in one batch, so a delete or a merge can't land between them.
 */
export async function createBlock(db: Db, input: NewBlock): Promise<CreatedBlock> {
  const [inserted, selected] = await db.batch([
    db
      .prepare(
        `INSERT INTO blocks (id, user_id, blocked_user_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, blocked_user_id) DO NOTHING`,
      )
      .bind(input.id, input.userId, input.blockedUserId, input.createdAt),
    db
      .prepare(
        "SELECT id, blocked_user_id AS blockedUserId FROM blocks WHERE user_id = ? AND blocked_user_id = ?",
      )
      .bind(input.userId, input.blockedUserId),
  ]);
  const [row] = z.array(blockRowSchema).parse(selected?.results);
  if (row === undefined) {
    throw new Error("Block missing after its insert in the same batch");
  }

  return { id: row.id, created: inserted?.meta.changes === 1 };
}

/** Removes the block if `userId` holds it. False when there is no such block or it is another user's. */
export async function deleteBlock(db: Db, blockId: string, userId: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM blocks WHERE id = ? AND user_id = ?")
    .bind(blockId, userId)
    .run();

  return result.meta.changes === 1;
}

/** The blocks `userId` holds, oldest first. */
export async function listBlocks(db: Db, userId: string): Promise<BlockRow[]> {
  const result = await db
    .prepare(
      `SELECT id, blocked_user_id AS blockedUserId FROM blocks
       WHERE user_id = ? ORDER BY created_at, id`,
    )
    .bind(userId)
    .all();

  return z.array(blockRowSchema).parse(result.results);
}

/** Whether `userId` blocks the author of the story's opening passage. */
export async function blocksOpeningAuthor(
  db: Db,
  storyId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `SELECT b.id, b.blocked_user_id AS blockedUserId
       FROM blocks b JOIN passages p ON p.author_id = b.blocked_user_id
       WHERE b.user_id = ? AND p.story_id = ? AND p.seq = 1`,
    )
    .bind(userId, storyId)
    .all();

  return z.array(blockRowSchema).parse(result.results).length > 0;
}
