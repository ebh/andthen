-- Three changes that belong together:
--   1. A display name belongs to a user, not to a participant, so one person has one name in every
--      story. It is unique across users, ignoring case.
--   2. contributions becomes passages, because every row is a passage.
--   3. A passage points at the user who wrote it, not at a participant.
-- Times are integer milliseconds since the Unix epoch.
-- suggestion_requests points at participants, so the rebuild drops a table it references. The check
-- on that reference waits until the batch commits, when the rows are back. See 0005_users.sql.
PRAGMA defer_foreign_keys = true;

-- The display name as typed, and the key that decides uniqueness: the name trimmed, NFKC-normalised
-- and case-folded by the app. Both are null for a user who has not yet started or joined a story.
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN display_name_key TEXT
  CHECK ((display_name IS NULL) = (display_name_key IS NULL));

-- A user takes the name of the participant that joined most recently. Users who share a key are
-- ranked by when they were made, earliest first. The earliest keeps the name. Each later one gets
-- the next free number appended, from 2 up, so "Sam" becomes "Sam 2". A number is free when no kept
-- name already has it: if someone else is called "Sam 2", the next "Sam" becomes "Sam 3".
--
-- Two numbered names never clash with each other. A numbered key splits at its last space into the
-- shared key and the number, so different shared keys or numbers always give different keys.
-- Appending digits to a key keeps it normalised.
--
-- A numbered name can run past the 40-character limit by its suffix. SQLite can neither count
-- characters as the app does (graphemes) nor make a key from a cut name (NFKC and case folding), so
-- cutting it here could split a character or leave a key that does not match its name. The limit
-- applies only to names people type; nothing checks the length of a stored name.
WITH RECURSIVE latest AS (
  SELECT user_id, display_name, display_name_key,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY joined_at DESC, id DESC) AS recency
  FROM participants
),
ranked AS (
  SELECT l.user_id, l.display_name, l.display_name_key,
    ROW_NUMBER() OVER (PARTITION BY l.display_name_key ORDER BY u.created_at, u.id) AS place
  FROM latest l JOIN users u ON u.id = l.user_id
  WHERE l.recency = 1
),
kept AS (
  SELECT display_name_key AS key FROM ranked WHERE place = 1
),
shared AS (
  SELECT display_name_key AS key FROM ranked GROUP BY display_name_key HAVING COUNT(*) > 1
),
-- Enough numbers for any shared key: one for each later user, plus one for each kept name that
-- could hold a number.
numbers (n) AS (
  SELECT 2
  UNION ALL
  SELECT n + 1 FROM numbers
  WHERE n < (SELECT MAX(place) FROM ranked) + (SELECT COUNT(*) FROM kept WHERE key GLOB '* [0-9]*')
),
free AS (
  SELECT s.key, n.n,
    ROW_NUMBER() OVER (PARTITION BY s.key ORDER BY n.n) + 1 AS place
  FROM shared s CROSS JOIN numbers n
  WHERE s.key || ' ' || n.n NOT IN (SELECT key FROM kept)
),
named AS (
  SELECT r.user_id,
    CASE WHEN r.place = 1 THEN r.display_name ELSE r.display_name || ' ' || f.n END AS name,
    CASE WHEN r.place = 1 THEN r.display_name_key ELSE r.display_name_key || ' ' || f.n END AS key
  FROM ranked r
  LEFT JOIN free f ON f.key = r.display_name_key AND f.place = r.place
)
UPDATE users SET
  display_name = (SELECT name FROM named WHERE named.user_id = users.id),
  display_name_key = (SELECT key FROM named WHERE named.user_id = users.id)
WHERE id IN (SELECT user_id FROM named);

-- Finds the user who holds a name when someone joins or starts a story. NULL keys never collide.
CREATE UNIQUE INDEX users_by_display_name_key ON users (display_name_key);

-- Append-only: rows are never updated, except that a merge moves them to another author.
CREATE TABLE passages (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories (id),
  author_id TEXT NOT NULL REFERENCES users (id),
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  starts_paragraph INTEGER NOT NULL DEFAULT 1 CHECK (starts_paragraph IN (0, 1)),
  UNIQUE (story_id, seq)
);

INSERT INTO passages (id, story_id, author_id, seq, text, created_at, starts_paragraph)
SELECT c.id, c.story_id, p.user_id, c.seq, c.text, c.created_at, c.starts_paragraph
FROM contributions c JOIN participants p ON p.id = c.participant_id;

DROP TABLE contributions;

-- Moves a leaving user's passages to the account user when two users merge.
CREATE INDEX passages_by_author ON passages (author_id);

-- participants loses the display name, so it is rebuilt.
CREATE TABLE participants_backup AS
SELECT id, story_id, position, user_id, joined_at, left_at FROM participants;

DROP TABLE participants;

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories (id),
  position INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  UNIQUE (story_id, position)
);

-- Inserted into the table the references name, which is what settles the deferred check.
INSERT INTO participants (id, story_id, position, user_id, joined_at, left_at)
SELECT id, story_id, position, user_id, joined_at, left_at FROM participants_backup;

DROP TABLE participants_backup;

-- A user is in a story once. Rows of someone who left may later share a user.
CREATE UNIQUE INDEX participants_active_by_user ON participants (story_id, user_id)
  WHERE left_at IS NULL;

-- Lists the stories one user is in. The unique indexes on participants all lead with story_id.
CREATE INDEX participants_by_user ON participants (user_id);
