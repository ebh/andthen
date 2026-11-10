import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigration, createTestEnv, type TestEnv } from "./support/testEnv";

describe("migration 0006_passages.sql", () => {
  let testEnv: TestEnv;
  let db: D1Database;

  beforeAll(async () => {
    testEnv = await createTestEnv({ migrateBefore: "0006_passages.sql" });
    db = testEnv.env.DB;
    await seedBeforePassages(db);
    await applyMigration(db, "0006_passages.sql");
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("gives a user the name of the participant that joined most recently", async () => {
    const row = await db
      .prepare("SELECT display_name AS name, display_name_key AS key FROM users WHERE id = 'u-ana'")
      .first();

    expect(row).toEqual({ name: "Ana", key: "ana" });
  });

  it("numbers a later user whose name clashes, ignoring case", async () => {
    const row = await db
      .prepare(
        "SELECT display_name AS name, display_name_key AS key FROM users WHERE id = 'u-ana2'",
      )
      .first();

    expect(row).toEqual({ name: "ANA 2", key: "ana 2" });
  });

  it("skips a number another user's kept name already has, and numbers a numbered name", async () => {
    const rows = await db
      .prepare(
        `SELECT id, display_name AS name, display_name_key AS key FROM users
         WHERE id LIKE 'u-sam%' ORDER BY id`,
      )
      .all();

    // "Sam 2" and "Sam 4" were names people chose, so the later two "Sam"s take 3 and 5. A later
    // "SAM 2" is numbered under its own key and clashes with none of them.
    expect(rows.results).toEqual([
      { id: "u-sam", name: "Sam", key: "sam" },
      { id: "u-sam-b", name: "sam 3", key: "sam 3" },
      { id: "u-sam-c", name: "SAM 5", key: "sam 5" },
      { id: "u-sam-four", name: "Sam 4", key: "sam 4" },
      { id: "u-sam-two", name: "Sam 2", key: "sam 2" },
      { id: "u-sam-two-b", name: "SAM 2 2", key: "sam 2 2" },
    ]);
  });

  it("breaks a tie on when two participants joined by participant id", async () => {
    const row = await db
      .prepare("SELECT display_name AS name FROM users WHERE id = 'u-tie'")
      .first();

    expect(row).toEqual({ name: "Tea" });
  });

  it("keeps a name that does not clash, even for a user who left", async () => {
    const row = await db
      .prepare("SELECT display_name AS name FROM users WHERE id = 'u-ben'")
      .first();

    expect(row).toEqual({ name: "Ben" });
  });

  it("leaves a user with no participant without a name", async () => {
    const row = await db
      .prepare(
        "SELECT display_name AS name, display_name_key AS key FROM users WHERE id = 'u-push'",
      )
      .first();

    expect(row).toEqual({ name: null, key: null });
  });

  it("refuses a name without its key, and the same key twice", async () => {
    await expect(
      db.prepare("UPDATE users SET display_name = 'Zed' WHERE id = 'u-push'").run(),
    ).rejects.toThrow(/CHECK/);
    await expect(
      db
        .prepare(
          "UPDATE users SET display_name = 'Ana', display_name_key = 'ana' WHERE id = 'u-ben'",
        )
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it("moves each contribution to passages, authored by its participant's user", async () => {
    const rows = await db
      .prepare(
        `SELECT id, story_id AS storyId, author_id AS authorId, seq, text, created_at AS createdAt,
           starts_paragraph AS startsParagraph FROM passages ORDER BY seq`,
      )
      .all();

    expect(rows.results).toEqual([
      {
        id: "c1",
        storyId: "aaaaa",
        authorId: "u-ana",
        seq: 1,
        text: "Once.",
        createdAt: 10,
        startsParagraph: 1,
      },
      {
        id: "c2",
        storyId: "aaaaa",
        authorId: "u-ana2",
        seq: 2,
        text: "Then.",
        createdAt: 11,
        startsParagraph: 0,
      },
    ]);
  });

  it("drops contributions and the name columns of participants", async () => {
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contributions'")
      .all();
    const columns = await db.prepare("SELECT name FROM pragma_table_info('participants')").all();

    expect(tables.results).toEqual([]);
    expect(columns.results.map(({ name }) => name)).toEqual([
      "id",
      "story_id",
      "position",
      "user_id",
      "joined_at",
      "left_at",
    ]);
  });

  it("keeps the participants, their indexes and the rows that reference them", async () => {
    const participants = await db
      .prepare(
        `SELECT id, user_id AS userId, left_at AS leftAt FROM participants
         WHERE story_id IN ('aaaaa', 'bbbbb') ORDER BY id`,
      )
      .all();
    const requests = await db.prepare("SELECT participant_id FROM suggestion_requests").all();
    const indexes = await db
      .prepare(
        "SELECT name FROM pragma_index_list('participants') WHERE origin = 'c' ORDER BY name",
      )
      .all();

    expect(participants.results).toEqual([
      { id: "p-ana-a", userId: "u-ana", leftAt: null },
      { id: "p-ana-b", userId: "u-ana", leftAt: null },
      { id: "p-ana2-a", userId: "u-ana2", leftAt: null },
      { id: "p-ben-a", userId: "u-ben", leftAt: 30 },
    ]);
    expect(requests.results).toEqual([{ participant_id: "p-ana-a" }]);
    expect(indexes.results).toEqual([
      { name: "participants_active_by_user" },
      { name: "participants_by_user" },
    ]);
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});

async function seedBeforePassages(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO stories (id, created_at) VALUES ('aaaaa', 1), ('bbbbb', 1), ('ccccc', 1),
         ('ddddd', 1), ('eeeee', 1)`,
    ),
    db.prepare(
      `INSERT INTO users (id, browser_token_hash, created_at) VALUES
         ('u-ana', 'hash-ana', 10), ('u-ana2', 'hash-ana2', 20), ('u-ben', 'hash-ben', 5),
         ('u-push', 'hash-push', 40), ('u-sam', 'hash-sam', 50), ('u-sam-two', 'hash-sam-two', 51),
         ('u-sam-four', 'hash-sam-four', 52), ('u-sam-two-b', 'hash-sam-two-b', 53),
         ('u-sam-b', 'hash-sam-b', 60),
         ('u-sam-c', 'hash-sam-c', 60), ('u-tie', 'hash-tie', 70)`,
    ),
    // u-ana joined story aaaaa as "Ana Old" and later story bbbbb as "Ana". u-ana2 is a later user
    // whose name differs from u-ana's only in case. u-ben is the earliest user and left.
    db.prepare(
      `INSERT INTO participants (id, story_id, display_name, display_name_key, position, user_id,
         joined_at, left_at) VALUES
         ('p-ana-a', 'aaaaa', 'Ana Old', 'ana old', 0, 'u-ana', 10, NULL),
         ('p-ana-b', 'bbbbb', 'Ana', 'ana', 0, 'u-ana', 15, NULL),
         ('p-ana2-a', 'aaaaa', 'ANA', 'ana', 1, 'u-ana2', 20, NULL),
         ('p-ben-a', 'aaaaa', 'Ben', 'ben', 2, 'u-ben', 25, 30)`,
    ),
    // u-sam keeps "Sam". u-sam-two and u-sam-four chose names that look like numbered ones, and
    // u-sam-two-b chose u-sam-two's name later.
    // u-sam-b and u-sam-c were made at the same time, so their ids order them. u-tie joined two
    // stories at the same moment.
    db.prepare(
      `INSERT INTO participants (id, story_id, display_name, display_name_key, position, user_id,
         joined_at, left_at) VALUES
         ('p-sam', 'ccccc', 'Sam', 'sam', 0, 'u-sam', 50, NULL),
         ('p-sam-two', 'ccccc', 'Sam 2', 'sam 2', 1, 'u-sam-two', 51, NULL),
         ('p-sam-four', 'ccccc', 'Sam 4', 'sam 4', 2, 'u-sam-four', 52, NULL),
         ('p-sam-two-b', 'ddddd', 'SAM 2', 'sam 2', 2, 'u-sam-two-b', 53, NULL),
         ('p-sam-b', 'ddddd', 'sam', 'sam', 0, 'u-sam-b', 60, NULL),
         ('p-sam-c', 'eeeee', 'SAM', 'sam', 0, 'u-sam-c', 60, NULL),
         ('p-tie-a', 'ddddd', 'Tia', 'tia', 1, 'u-tie', 70, NULL),
         ('p-tie-b', 'eeeee', 'Tea', 'tea', 1, 'u-tie', 70, NULL)`,
    ),
    db.prepare(
      `INSERT INTO contributions (id, story_id, participant_id, seq, text, created_at, starts_paragraph)
       VALUES ('c1', 'aaaaa', 'p-ana-a', 1, 'Once.', 10, 1), ('c2', 'aaaaa', 'p-ana2-a', 2, 'Then.', 11, 0)`,
    ),
    db.prepare(
      "INSERT INTO suggestion_requests (id, participant_id, created_at) VALUES ('r1', 'p-ana-a', 11)",
    ),
  ]);
}
