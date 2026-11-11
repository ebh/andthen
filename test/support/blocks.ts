/** Adds a block straight to D1, with no check that either user exists beyond the foreign keys. */
export async function insertBlock(
  db: Env["DB"],
  block: { id: string; userId: string; blockedUserId: string; createdAt: number },
): Promise<void> {
  await db
    .prepare("INSERT INTO blocks (id, user_id, blocked_user_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(block.id, block.userId, block.blockedUserId, block.createdAt)
    .run();
}
