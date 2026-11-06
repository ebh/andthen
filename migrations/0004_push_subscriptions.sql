-- A browser's Web Push subscription. A browser has one per push service endpoint, covering every
-- story it is in, so rows key on the browser's token hash, not on a participant.
-- Times are integer milliseconds since the Unix epoch.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  browser_token_hash TEXT NOT NULL,
  -- The browser's public key and authentication secret, base64url, used to encrypt each message.
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Finds a browser's subscriptions when it is handed the turn.
CREATE INDEX push_subscriptions_by_browser ON push_subscriptions (browser_token_hash);
