-- Whether a contribution begins a new paragraph. Existing rows each began their own paragraph,
-- so the default of 1 keeps old stories looking as they did; every insert sets the value itself.
ALTER TABLE contributions
  ADD COLUMN starts_paragraph INTEGER NOT NULL DEFAULT 1 CHECK (starts_paragraph IN (0, 1));
