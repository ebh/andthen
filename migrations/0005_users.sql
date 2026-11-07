-- A user is who a participant or a push subscription belongs to. For now every user is anonymous
-- and is found by the hash of its browser's token; a user with an account will be found by its
-- Clerk user ID instead. Times are integer milliseconds since the Unix epoch.
-- contributions and suggestion_requests point at participants, so the rebuild drops a table they
-- reference. The check on those references waits until the batch commits, when the rows are back.
-- It only counts rows put back into a table named participants, so a rename would not settle it.
PRAGMA defer_foreign_keys = true;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT UNIQUE,
  browser_token_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  CHECK (clerk_user_id IS NOT NULL OR browser_token_hash IS NOT NULL)
);

-- One user per browser that already has a participant or a push subscription, created when its
-- earliest row was.
INSERT INTO users (id, browser_token_hash, created_at)
SELECT lower(hex(randomblob(16))), browser_token_hash, MIN(seen_at)
FROM (
  SELECT browser_token_hash, joined_at AS seen_at FROM participants
  UNION ALL
  SELECT browser_token_hash, created_at AS seen_at FROM push_subscriptions
)
GROUP BY browser_token_hash;

-- Holds the rows while participants is dropped and created again.
CREATE TABLE participants_backup AS
SELECT p.id, p.story_id, p.display_name, p.display_name_key, p.position, u.id AS user_id,
  p.joined_at, p.left_at
FROM participants p JOIN users u ON u.browser_token_hash = p.browser_token_hash;

DROP TABLE participants;

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories (id),
  display_name TEXT NOT NULL,
  display_name_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  UNIQUE (story_id, position),
  UNIQUE (story_id, display_name_key)
);

-- Inserted into the table the references name, which is what settles the deferred check.
INSERT INTO participants
  (id, story_id, display_name, display_name_key, position, user_id, joined_at, left_at)
SELECT id, story_id, display_name, display_name_key, position, user_id, joined_at, left_at
FROM participants_backup;

DROP TABLE participants_backup;

-- A user is in a story once. Rows of someone who left may later share a user.
CREATE UNIQUE INDEX participants_active_by_user ON participants (story_id, user_id)
  WHERE left_at IS NULL;

-- Lists the stories one user is in. The unique indexes on participants all lead with story_id.
CREATE INDEX participants_by_user ON participants (user_id);

CREATE TABLE push_subscriptions_new (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The browser's public key and authentication secret, base64url, used to encrypt each message.
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO push_subscriptions_new (endpoint, user_id, p256dh, auth, created_at)
SELECT s.endpoint, u.id, s.p256dh, s.auth, s.created_at
FROM push_subscriptions s JOIN users u ON u.browser_token_hash = s.browser_token_hash;

DROP TABLE push_subscriptions;
ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;

-- Finds a user's subscriptions when they are handed the turn.
CREATE INDEX push_subscriptions_by_user ON push_subscriptions (user_id);
