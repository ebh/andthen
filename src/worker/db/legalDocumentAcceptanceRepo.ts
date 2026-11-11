import { z } from "zod";

import { legalDocumentAcceptanceRowSchema, type LegalDocumentAcceptanceRow } from "./rows";
import type { Db } from "./storyRepo";
import type { NewLegalDocumentAcceptance } from "./typeSchemas";

/** Records one legal document acceptance. Rows are never updated or deleted. */
export async function saveLegalDocumentAcceptance(
  db: Db,
  input: NewLegalDocumentAcceptance,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO legal_document_acceptances
         (id, user_id, legal_document_id, version, story_id, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.userId,
      input.legalDocumentId,
      input.version,
      input.storyId,
      input.acceptedAt,
    )
    .run();
}

/** The legal document acceptances a user gave with no story, so for per-user legal documents. */
export async function loadPerUserLegalDocumentAcceptances(
  db: Db,
  userId: string,
): Promise<LegalDocumentAcceptanceRow[]> {
  const result = await db
    .prepare(
      `SELECT legal_document_id AS legalDocumentId, version FROM legal_document_acceptances
       WHERE user_id = ? AND story_id IS NULL`,
    )
    .bind(userId)
    .all();

  return z.array(legalDocumentAcceptanceRowSchema).parse(result.results);
}
