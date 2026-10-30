-- Times are integer milliseconds since the Unix epoch.

CREATE TABLE stories (
  id TEXT PRIMARY KEY CHECK (length(id) = 5),
  created_at INTEGER NOT NULL,
  -- NULL means the story is waiting for a joiner.
  current_position INTEGER,
  turn_started_at INTEGER,
  turn_version INTEGER NOT NULL DEFAULT 0,
  last_contributor_position INTEGER
);

CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories (id),
  display_name TEXT NOT NULL,
  display_name_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  browser_token_hash TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  UNIQUE (story_id, position),
  UNIQUE (story_id, display_name_key),
  UNIQUE (story_id, browser_token_hash)
);

-- Append-only: rows are never updated.
CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES stories (id),
  participant_id TEXT NOT NULL REFERENCES participants (id),
  seq INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (story_id, seq)
);

CREATE TABLE suggestion_requests (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (id),
  created_at INTEGER NOT NULL
);

CREATE INDEX suggestion_requests_by_participant_time
  ON suggestion_requests (participant_id, created_at);
