-- When a participant left their story, in epoch ms; null while they are in it. A leaver's row stays
-- so their passages keep an author and their name stays reserved in that story.
ALTER TABLE participants ADD COLUMN left_at INTEGER;

-- Lists the stories one browser is in. The unique indexes on participants all lead with story_id.
CREATE INDEX participants_by_browser ON participants (browser_token_hash);
