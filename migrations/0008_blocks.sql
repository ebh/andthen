-- A block points from one user to another user, never to a participant, so it holds in every story
-- the two share. It hides the blocked user's passages from the blocking user only. Times are
-- integer milliseconds since the Unix epoch.
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  blocked_user_id TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, blocked_user_id),
  CHECK (user_id <> blocked_user_id)
);

-- Finds the blocks against a user when two users are merged, and lets deleting a user check that no
-- block still points at it. The unique pair leads with user_id, so it already serves the list of a
-- user's blocks and the push lookup of whether a user blocks an author.
CREATE INDEX blocks_by_blocked_user_id ON blocks (blocked_user_id);
