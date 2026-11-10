import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBrowser,
  createStory,
  createTestApp,
  joinStory,
  readError,
  readStory,
  T0,
  type Browser,
  type Clock,
  nameInTest,
} from "../../../test/support/browser";
import { createTestEnv, type TestEnv } from "../../../test/support/testEnv";
import { insertUser, userIdOf } from "../../../test/support/users";
import { blocksResponseSchema, blockUserResponseSchema } from "../../shared/api";

describe("blocking a user", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock);
  const userId = (browser: Browser) => userIdOf(testEnv.env.DB, browser);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  const newBrowser = () => createBrowser(app, testEnv.env);

  // A browser that has a user, because it started a story.
  async function newWriter(name: string): Promise<Browser> {
    const browser = newBrowser();
    await createStory(browser, nameInTest(name));

    return browser;
  }

  describe("POST /api/users/me/blocks", () => {
    it("answers 201 with a Location for a new block, and 200 with the same ID for a repeat", async () => {
      const ana = await newWriter("Ana");
      const ben = await newWriter("Ben");
      const blockedUserId = await userId(ben);

      const first = await block(ana, blockedUserId);
      const { blockId } = blockUserResponseSchema.parse(await first.json());
      const repeat = await block(ana, blockedUserId);

      expect(first.status).toBe(201);
      expect(first.headers.get("Location")).toBe(`/api/users/me/blocks/${blockId}`);
      expect(repeat.status).toBe(200);
      expect(repeat.headers.get("Location")).toBe(`/api/users/me/blocks/${blockId}`);
      expect(blockUserResponseSchema.parse(await repeat.json())).toEqual({ blockId });
      expect(await storedBlocks(await userId(ana))).toEqual([
        { id: blockId, blockedUserId, createdAt: T0 },
      ]);
    });

    it("answers 400 cannot_block_self when the caller names themselves", async () => {
      const ana = await newWriter("Ana");

      const response = await block(ana, await userId(ana));

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("cannot_block_self");
      expect(await storedBlocks(await userId(ana))).toEqual([]);
    });

    it("answers 404 not_found for a user that does not exist", async () => {
      const ana = await newWriter("Ana");

      const response = await block(ana, "no-such-user");

      expect(response.status).toBe(404);
      expect(await readError(response)).toBe("not_found");
    });

    it("answers 404 not_found for a caller who has no user", async () => {
      const ben = await newWriter("Ben");

      const response = await block(newBrowser(), await userId(ben));

      expect(response.status).toBe(404);
      expect(await readError(response)).toBe("not_found");
    });

    it.each([
      ["no blockedUserId", {}],
      ["an empty blockedUserId", { blockedUserId: "" }],
      ["a blockedUserId that is not a string", { blockedUserId: 7 }],
    ])("answers 400 bad_request for a body with %s", async (_name, body) => {
      const response = await (await newWriter("Ana")).post("/api/users/me/blocks", body);

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
    });
  });

  describe("GET /api/users/me/blocks", () => {
    it("is empty for a caller with no user, and for a user who blocks no one", async () => {
      const empty = { blocks: [] };

      const stranger = await newBrowser().get("/api/users/me/blocks");
      const ana = await (await newWriter("Ana")).get("/api/users/me/blocks");

      expect(stranger.status).toBe(200);
      expect(blocksResponseSchema.parse(await stranger.json())).toEqual(empty);
      expect(blocksResponseSchema.parse(await ana.json())).toEqual(empty);
    });

    it("lists only the caller's blocks, oldest first, breaking a tie by ID", async () => {
      const ana = await newWriter("Ana");
      const anaId = await userId(ana);
      const other = await insertUser(testEnv.env.DB, "list-other");
      const x = await insertUser(testEnv.env.DB, "list-x");
      const y = await insertUser(testEnv.env.DB, "list-y");
      const z = await insertUser(testEnv.env.DB, "list-z");
      const w = await insertUser(testEnv.env.DB, "list-w");
      // The IDs sort against the times, so only created_at puts "later" after "earlier".
      await insertBlock("b-3", anaId, x, 1);
      await insertBlock("b-2", anaId, y, 2);
      await insertBlock("b-1", anaId, z, 2);
      await insertBlock("b-0", other, w, 0);

      const response = await ana.get("/api/users/me/blocks");

      expect(blocksResponseSchema.parse(await response.json())).toEqual({
        blocks: [
          { id: "b-3", blockedUserId: x },
          { id: "b-1", blockedUserId: z },
          { id: "b-2", blockedUserId: y },
        ],
      });
    });

    it("holds in every story the two share, as one block that matches the author in each", async () => {
      const ben = await newWriter("Ben");
      const ana = newBrowser();
      const first = await createStory(ben, undefined, "Ben's first opening.");
      const second = await createStory(ben, undefined, "Ben's second opening.");
      await joinStory(ana, first, nameInTest("Ana"));
      await joinStory(ana, second);
      const benId = await userId(ben);
      await block(ana, benId);

      const { blocks } = blocksResponseSchema.parse(
        await (await ana.get("/api/users/me/blocks")).json(),
      );

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.blockedUserId).toBe(benId);
      expect((await readStory(ana, first)).passages[0]?.authorId).toBe(benId);
      expect((await readStory(ana, second)).passages[0]?.authorId).toBe(benId);
    });

    it("shows the blocked user no block", async () => {
      const ana = await newWriter("Ana");
      const ben = await newWriter("Ben");
      await block(ana, await userId(ben));

      const response = await ben.get("/api/users/me/blocks");

      expect(blocksResponseSchema.parse(await response.json())).toEqual({ blocks: [] });
    });
  });

  describe("DELETE /api/users/me/blocks/:blockId", () => {
    it("removes the block with 204, answers 404 for the same ID, and lets the user block again", async () => {
      const ana = await newWriter("Ana");
      const ben = await newWriter("Ben");
      const blockedUserId = await userId(ben);
      const { blockId } = blockUserResponseSchema.parse(
        await (await block(ana, blockedUserId)).json(),
      );

      const removed = await ana.delete(`/api/users/me/blocks/${blockId}`);
      const again = await ana.delete(`/api/users/me/blocks/${blockId}`);
      const reblocked = await block(ana, blockedUserId);

      expect(removed.status).toBe(204);
      expect(again.status).toBe(404);
      expect(await readError(again)).toBe("not_found");
      expect(reblocked.status).toBe(201);
      expect(blockUserResponseSchema.parse(await reblocked.json()).blockId).not.toBe(blockId);
    });

    it("answers 404 for a block another user holds, and keeps it", async () => {
      const ana = await newWriter("Ana");
      const ben = await newWriter("Ben");
      const { blockId } = blockUserResponseSchema.parse(
        await (await block(ana, await userId(ben))).json(),
      );

      const response = await ben.delete(`/api/users/me/blocks/${blockId}`);

      expect(response.status).toBe(404);
      expect(await readError(response)).toBe("not_found");
      expect(await storedBlocks(await userId(ana))).toHaveLength(1);
    });

    it("answers 404 for an ID that names no block, and for a caller with no user", async () => {
      const unknown = await (await newWriter("Ana")).delete("/api/users/me/blocks/nope");
      const stranger = await newBrowser().delete("/api/users/me/blocks/nope");

      expect(unknown.status).toBe(404);
      expect(await readError(unknown)).toBe("not_found");
      expect(stranger.status).toBe(404);
      expect(await readError(stranger)).toBe("not_found");
    });
  });

  async function insertBlock(
    id: string,
    blockerId: string,
    blockedUserId: string,
    createdAt: number,
  ): Promise<void> {
    await testEnv.env.DB.prepare(
      "INSERT INTO blocks (id, user_id, blocked_user_id, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(id, blockerId, blockedUserId, createdAt)
      .run();
  }

  async function storedBlocks(blockerId: string) {
    const result = await testEnv.env.DB.prepare(
      `SELECT id, blocked_user_id AS blockedUserId, created_at AS createdAt
       FROM blocks WHERE user_id = ? ORDER BY id`,
    )
      .bind(blockerId)
      .all();

    return result.results;
  }
});

function block(browser: Browser, blockedUserId: string): Promise<Response> {
  return browser.post("/api/users/me/blocks", { blockedUserId });
}
