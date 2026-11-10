---
paths:
  - "migrations/**"
  - "test/migrations.*.test.ts"
---

# Migration rules

How to write the SQL of a migration. `database.md` covers the other half: keeping the Zod table schemas and `docs/database.md` in step with it.

## Rules

- **A migration is a new file, `NNNN_snake_case.sql`, numbered after the last one.** Never edit an applied migration.
  - Open it with a comment saying what changes and why. Times are integer milliseconds since the Unix epoch.
- **Use `ALTER TABLE` when it can do the job.**
  - `RENAME TO`, `RENAME COLUMN` and `ADD COLUMN` work in place.
  - `ADD COLUMN` cannot add `UNIQUE` or a primary key, and a `NOT NULL` column needs a default. Add uniqueness with a separate `CREATE UNIQUE INDEX`.
  - `DROP COLUMN` fails while the column is in a key, a `UNIQUE` constraint, an index, a foreign key or a `CHECK`. That change is a rebuild.
- **A rebuild copies the rows to a new table.**
  - When other tables reference the table: set `PRAGMA defer_foreign_keys = true`, copy the rows into a backup table, drop the table, create it again, insert from the backup into the table under its own name, drop the backup, then recreate its indexes. `0005_users.sql` is the worked example.
    - Why: the deferred check settles only on rows put back into a table with that name, so a rename would not settle it.
  - When nothing references the table: create `<table>_new`, copy, drop the old table, then rename the new one.
  - Recreate every index and constraint the old table had, unless the change drops it.
- **D1 applies one migration file as one transaction.** Do not write `BEGIN` or `COMMIT`.
- **A backfill fills every new `NOT NULL` column and gives the same result in every environment.**
  - Order by a stable key and break ties with `id`.
  - Make new IDs with `lower(hex(randomblob(16)))`.
- **Name an index `<table>_by_<columns>`,** and comment the query that needs it.
- **A migration that moves or derives data has `test/migrations.<name>.test.ts`.**
  - Model it on `test/migrations.users.test.ts`: `createTestEnv({ migrateBefore })`, seed rows, `applyMigration`, then check the rows.
  - Seed the awkward cases: a row with nothing to move, a tie, a left participant.
- **When a backfill depends on what live data holds, check live data before merge.**
  - Examples: name clashes, nulls, lengths.
  - Write read-only queries that count the problem rows. Put them in the PR description for the owner to run with `wrangler d1 execute --remote`.
  - Merge only after they report zero, or the owner has decided what to do about the rest.
- **A migration can make a legal document false without adding a column.** Changing existing rows, or who can see them, counts. See `legal-impact.md`.
