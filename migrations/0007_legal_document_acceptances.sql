-- A legal document acceptance is one user's recorded yes to one version of one legal document.
-- Rows are only ever added, so the table shows what each user agreed to and when. story_id is set
-- for a legal document accepted per story and null for one accepted per user. Times are integer
-- milliseconds since the Unix epoch.
CREATE TABLE legal_document_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  legal_document_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  story_id TEXT REFERENCES stories (id),
  accepted_at INTEGER NOT NULL
);

-- Finds a user's legal document acceptances for GET /api/users/me.
CREATE INDEX legal_document_acceptances_by_user_id ON legal_document_acceptances (user_id);
