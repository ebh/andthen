import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { applyMigration, createTestEnv, type TestEnv } from "./support/testEnv";

describe("migration 0005_users.sql", () => {
  let testEnv: TestEnv;
  let db: D1Database;

  beforeAll(async () => {
    testEnv = await createTestEnv({ migrateBefore: "0005_users.sql" });
    db = testEnv.env.DB;
    await seedBeforeUsers(db);
    await applyMigration(db, "0005_users.sql");
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("creates one user per distinct browser token hash, dated by its earliest row", async () => {
    const users = await db
      .prepare("SELECT browser_token_hash AS hash, created_at AS createdAt FROM users ORDER BY 1")
      .all();

    expect(users.results).toEqual([
      { hash: "hash-ana", createdAt: 10 },
      { hash: "hash-ben", createdAt: 20 },
      { hash: "hash-push-only", createdAt: 5 },
    ]);
  });

  it("points each participant at its browser's user and keeps ids and left_at", async () => {
    const rows = await db
      .prepare(
        `SELECT p.id, p.story_id AS storyId, p.left_at AS leftAt, u.browser_token_hash AS hash
         FROM participants p JOIN users u ON u.id = p.user_id ORDER BY p.id`,
      )
      .all();

    expect(rows.results).toEqual([
      { id: "p-ana-a", storyId: "aaaaa", leftAt: null, hash: "hash-ana" },
      { id: "p-ana-b", storyId: "bbbbb", leftAt: null, hash: "hash-ana" },
      { id: "p-ben-a", storyId: "aaaaa", leftAt: 30, hash: "hash-ben" },
    ]);
  });

  it("points each push subscription at its browser's user", async () => {
    const rows = await db
      .prepare(
        `SELECT s.endpoint, u.browser_token_hash AS hash FROM push_subscriptions s
         JOIN users u ON u.id = s.user_id ORDER BY s.endpoint`,
      )
      .all();

    expect(rows.results).toEqual([
      { endpoint: "https://push.test/ana", hash: "hash-ana" },
      { endpoint: "https://push.test/only", hash: "hash-push-only" },
    ]);
  });

  it("keeps the rows that reference participants", async () => {
    const contributions = await db.prepare("SELECT participant_id FROM contributions").all();
    const requests = await db.prepare("SELECT participant_id FROM suggestion_requests").all();

    expect(contributions.results).toEqual([{ participant_id: "p-ana-a" }]);
    expect(requests.results).toEqual([{ participant_id: "p-ana-a" }]);
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("allows a user one active participant per story, but not two", async () => {
    // The tests share one database. Without this cleanup, the extra rows break the participants
    // test whenever this one runs first.
    onTestFinished(async () => {
      await db.prepare("DELETE FROM participants WHERE id IN ('left-copy', 'active-copy')").run();
    });

    await copyAnaParticipant(db, "left-copy", "Left", 5, 40);
    await expect(copyAnaParticipant(db, "active-copy", "Active", 6, null)).rejects.toThrow(
      /UNIQUE/,
    );
  });
});

async function seedBeforeUsers(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO stories (id, created_at) VALUES ('aaaaa', 1), ('bbbbb', 1)"),
    db.prepare(
      `INSERT INTO participants (id, story_id, display_name, display_name_key, position,
         browser_token_hash, joined_at, left_at) VALUES
         ('p-ana-a', 'aaaaa', 'Ana', 'ana', 0, 'hash-ana', 10, NULL),
         ('p-ana-b', 'bbbbb', 'Ana', 'ana', 0, 'hash-ana', 15, NULL),
         ('p-ben-a', 'aaaaa', 'Ben', 'ben', 1, 'hash-ben', 20, 30)`,
    ),
    db.prepare(
      `INSERT INTO contributions (id, story_id, participant_id, seq, text, created_at)
       VALUES ('c1', 'aaaaa', 'p-ana-a', 1, 'Once.', 10)`,
    ),
    db.prepare(
      "INSERT INTO suggestion_requests (id, participant_id, created_at) VALUES ('r1', 'p-ana-a', 11)",
    ),
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, browser_token_hash, p256dh, auth, created_at)
       VALUES ('https://push.test/ana', 'hash-ana', 'k', 'a', 12),
              ('https://push.test/only', 'hash-push-only', 'k', 'a', 5)`,
    ),
  ]);
}

async function copyAnaParticipant(
  db: D1Database,
  id: string,
  name: string,
  position: number,
  leftAt: number | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO participants (id, story_id, display_name, display_name_key, position,
         user_id, joined_at, left_at)
       SELECT ?, 'bbbbb', ?, ?, ?, user_id, 1, ? FROM participants WHERE id = 'p-ana-b'`,
    )
    .bind(id, name, name, position, leftAt)
    .run();
}
