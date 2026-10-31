import type { Db } from "./storyRepo";

export interface SuggestionReservation {
  id: string;
  participantId: string;
  now: number;
  /** A request counts against the limit while it is newer than `now - windowMs`. */
  windowMs: number;
  limit: number;
}

/**
 * Counts the participant's requests in the window and records this one, as a single statement,
 * so concurrent requests can't both see room for one more. False when the participant is at the
 * limit; nothing is written then.
 */
export async function reserveSuggestion(
  db: Db,
  reservation: SuggestionReservation,
): Promise<boolean> {
  const { id, participantId, now, windowMs, limit } = reservation;

  const result = await db
    .prepare(
      `INSERT INTO suggestion_requests (id, participant_id, created_at)
       SELECT ?, ?, ?
       WHERE (SELECT COUNT(*) FROM suggestion_requests
              WHERE participant_id = ? AND created_at > ?) < ?`,
    )
    .bind(id, participantId, now, participantId, now - windowMs, limit)
    .run();

  return result.meta.changes === 1;
}

/** Gives a reserved request back, because the provider failed and the participant got nothing. */
export async function releaseSuggestion(db: Db, id: string): Promise<void> {
  await db.prepare("DELETE FROM suggestion_requests WHERE id = ?").bind(id).run();
}
