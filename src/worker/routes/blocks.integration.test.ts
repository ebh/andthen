import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createBrowser,
  createStory,
  createTestApp,
  readError,
  T0,
  type Browser,
  type Clock,
  nameInTest,
} from "../../../test/support/browser";
import { insertBlock } from "../../../test/support/blocks";
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

  it("walks a block through create, repeat, list, remove and block again", async () => {
    const ana = await newWriter("Ana");
    const blockedUserId = await userId(await newWriter("Ben"));

    const stranger = await newBrowser().get("/api/users/me/blocks");
    const first = await block(ana, blockedUserId);
    const { blockId } = blockUserResponseSchema.parse(await first.json());
    const repeat = await block(ana, blockedUserId);
    const listed = await ana.get("/api/users/me/blocks");

    expect(blocksResponseSchema.parse(await stranger.json())).toEqual({ blocks: [] });
    expect(first.status).toBe(201);
    expect(first.headers.get("Location")).toBe(`/api/users/me/blocks/${blockId}`);
    expect(repeat.status).toBe(200);
    expect(blockUserResponseSchema.parse(await repeat.json())).toEqual({ blockId });
    expect(blocksResponseSchema.parse(await listed.json())).toEqual({
      blocks: [{ id: blockId, blockedUserId }],
    });
    expect(await storedBlocks(await userId(ana))).toEqual([
      { id: blockId, blockedUserId, createdAt: T0 },
    ]);

    const removed = await ana.delete(`/api/users/me/blocks/${blockId}`);
    const removedAgain = await ana.delete(`/api/users/me/blocks/${blockId}`);
    const reblocked = await block(ana, blockedUserId);

    expect(removed.status).toBe(204);
    expect(removedAgain.status).toBe(404);
    expect(reblocked.status).toBe(201);
    expect(blockUserResponseSchema.parse(await reblocked.json()).blockId).not.toBe(blockId);

    // Two requests at once for a pair with no block: one creates it, the other finds it.
    const catId = await userId(await newWriter("Cat"));
    const [a, b] = await Promise.all([block(ana, catId), block(ana, catId)]);

    expect([a.status, b.status].toSorted((left, right) => left - right)).toEqual([200, 201]);
    const racedIds = [
      blockUserResponseSchema.parse(await a.json()).blockId,
      blockUserResponseSchema.parse(await b.json()).blockId,
    ];
    expect(racedIds[0]).toBe(racedIds[1]);
    expect(
      (await storedBlocks(await userId(ana))).filter((row) => row.blockedUserId === catId),
    ).toHaveLength(1);
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
    await insertBlock(testEnv.env.DB, { id: "b-3", userId: anaId, blockedUserId: x, createdAt: 1 });
    await insertBlock(testEnv.env.DB, { id: "b-2", userId: anaId, blockedUserId: y, createdAt: 2 });
    await insertBlock(testEnv.env.DB, { id: "b-1", userId: anaId, blockedUserId: z, createdAt: 2 });
    await insertBlock(testEnv.env.DB, { id: "b-0", userId: other, blockedUserId: w, createdAt: 0 });

    const response = await ana.get("/api/users/me/blocks");

    expect(blocksResponseSchema.parse(await response.json())).toEqual({
      blocks: [
        { id: "b-3", blockedUserId: x },
        { id: "b-1", blockedUserId: z },
        { id: "b-2", blockedUserId: y },
      ],
    });
  });

  it("answers 400 cannot_block_self when the caller names themselves", async () => {
    const ana = await newWriter("Ana");

    const response = await block(ana, await userId(ana));

    expect(response.status).toBe(400);
    expect(await readError(response)).toBe("cannot_block_self");
    expect(await storedBlocks(await userId(ana))).toEqual([]);
  });

  it("answers 404 not_found for an unknown user, a caller with no user, and a block that is not the caller's", async () => {
    const ana = await newWriter("Ana");
    const ben = await newWriter("Ben");
    const { blockId } = blockUserResponseSchema.parse(
      await (await block(ana, await userId(ben))).json(),
    );

    const responses = [
      await block(ana, "no-such-user"),
      await block(newBrowser(), await userId(ben)),
      await ben.delete(`/api/users/me/blocks/${blockId}`),
      await newBrowser().delete(`/api/users/me/blocks/${blockId}`),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await readError(response)).toBe("not_found");
    }
    expect(await storedBlocks(await userId(ana))).toHaveLength(1);
  });

  it("answers 400 bad_request for a body that names no user", async () => {
    const response = await (await newWriter("Ana")).post("/api/users/me/blocks", {});

    expect(response.status).toBe(400);
    expect(await readError(response)).toBe("bad_request");
  });

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
