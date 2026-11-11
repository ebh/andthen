import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { newStoryState } from "../src/shared/turnOrder";
import type { UserRow } from "../src/worker/db/rows";
import {
  loadPerUserLegalDocumentAcceptances,
  saveLegalDocumentAcceptance,
} from "../src/worker/db/legalDocumentAcceptanceRepo";
import { createStory } from "../src/worker/db/storyRepo";
import {
  createAnonymousUser,
  findUserByBrowserTokenHash,
  findUserByDisplayNameKey,
  mergeUserInto,
} from "../src/worker/db/userRepo";
import { createTestEnv, type TestEnv } from "./support/testEnv";
import { insertBlock } from "./support/blocks";
import { insertUser } from "./support/users";

describe("userRepo", () => {
  let testEnv: TestEnv;
  let db: Env["DB"];

  beforeAll(async () => {
    testEnv = await createTestEnv();
    db = testEnv.env.DB;
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("finds the user a browser token hash names, and null for an unknown one", async () => {
    const created = await createAnonymousUser(db, {
      id: "u1",
      browserTokenHash: "h1",
      createdAt: 1,
    });

    expect(created).toEqual({ id: "u1", displayName: null, displayNameKey: null });
    expect(await findUserByBrowserTokenHash(db, "h1")).toEqual(created);
    expect(await findUserByBrowserTokenHash(db, "unknown")).toBeNull();
  });

  it("returns the existing user when another request created one for the hash first", async () => {
    await createAnonymousUser(db, { id: "first", browserTokenHash: "race", createdAt: 1 });

    const second = await createAnonymousUser(db, {
      id: "second",
      browserTokenHash: "race",
      createdAt: 2,
    });

    expect(second).toEqual({ id: "first", displayName: null, displayNameKey: null });
    const stored = await db.prepare("SELECT id FROM users WHERE browser_token_hash = 'race'").all();
    expect(stored.results).toEqual([{ id: "first" }]);
  });

  describe("mergeUserInto", () => {
    it("moves the passages and keeps the account user's name, freeing the device user's", async () => {
      await userWhoStarted(db, "m1-account", "m1a01", "Mia");
      const device = await userWhoStarted(db, "m1-device", "m1d01", "Max");

      await mergeUserInto(db, device, "m1-account");

      expect(await authorsOf(db, "m1d01")).toEqual(["m1-account"]);
      expect((await findUserByDisplayNameKey(db, "mia"))?.id).toBe("m1-account");
      expect(await findUserByDisplayNameKey(db, "max")).toBeNull();
    });

    it("gives the account user the device user's name when it has none", async () => {
      await insertUser(db, "m2-account");
      const device = await userWhoStarted(db, "m2-device", "m2d01", "Nia");

      await mergeUserInto(db, device, "m2-account");

      expect((await findUserByDisplayNameKey(db, "nia"))?.id).toBe("m2-account");
    });

    it("changes nothing when repeated", async () => {
      await userWhoStarted(db, "m3-account", "m3a01", "Oli");
      const device = await userWhoStarted(db, "m3-device", "m3d01", "Pat");
      expect(await mergeUserInto(db, device, "m3-account")).toBe(true);

      expect(await mergeUserInto(db, device, "m3-account")).toBe(false);

      expect(await authorsOf(db, "m3d01")).toEqual(["m3-account"]);
      expect((await findUserByDisplayNameKey(db, "oli"))?.id).toBe("m3-account");
      expect(await findUserByDisplayNameKey(db, "pat")).toBeNull();
    });

    // A join or start can name the device user after the route read it. Merging the stale row
    // would delete the user and its new name with it, and leave the account user with no name.
    it("refuses a device user named after it was read, and merges once it is read again", async () => {
      await insertUser(db, "m4-account");
      const stale = await userWhoStarted(db, "m4-device", "m4d01", null);
      await saveLegalDocumentAcceptance(db, {
        id: "m4-acceptance",
        userId: "m4-device",
        legalDocumentId: "terms-of-service",
        version: 1,
        storyId: null,
        acceptedAt: 1,
      });
      await db
        .prepare("UPDATE users SET display_name = 'Quin', display_name_key = 'quin' WHERE id = ?")
        .bind("m4-device")
        .run();

      expect(await mergeUserInto(db, stale, "m4-account")).toBe(false);
      expect(await authorsOf(db, "m4d01")).toEqual(["m4-device"]);
      expect(await loadPerUserLegalDocumentAcceptances(db, "m4-device")).toHaveLength(1);
      expect((await findUserByDisplayNameKey(db, "quin"))?.id).toBe("m4-device");

      const fresh = await userOf(db, "m4-device");
      expect(await mergeUserInto(db, fresh, "m4-account")).toBe(true);
      expect(await authorsOf(db, "m4d01")).toEqual(["m4-account"]);
      expect(await loadPerUserLegalDocumentAcceptances(db, "m4-device")).toEqual([]);
      expect(await loadPerUserLegalDocumentAcceptances(db, "m4-account")).toEqual([
        { legalDocumentId: "terms-of-service", version: 1 },
      ]);
      expect((await findUserByDisplayNameKey(db, "quin"))?.id).toBe("m4-account");
    });

    describe("blocks", () => {
      it("moves the merged-away user's blocks to the account user, and drops one that would repeat or block the user on itself", async () => {
        const device = await insertedUser(db, "mb-device");
        for (const id of ["mb-account", "mb-made", "mb-against", "mb-repeat"]) {
          await insertUser(db, id);
        }
        await insertBlock(db, {
          id: "mb-moved-made",
          userId: "mb-device",
          blockedUserId: "mb-made",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb-moved-against",
          userId: "mb-against",
          blockedUserId: "mb-device",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb-kept-made",
          userId: "mb-account",
          blockedUserId: "mb-repeat",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb-dropped-made",
          userId: "mb-device",
          blockedUserId: "mb-repeat",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb-kept-against",
          userId: "mb-repeat",
          blockedUserId: "mb-account",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb-dropped-against",
          userId: "mb-repeat",
          blockedUserId: "mb-device",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb-self-made",
          userId: "mb-device",
          blockedUserId: "mb-account",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb-self-against",
          userId: "mb-account",
          blockedUserId: "mb-device",
          createdAt: 0,
        });

        expect(await mergeUserInto(db, device, "mb-account")).toBe(true);

        expect(await blocksOf(db, "mb-moved-made")).toEqual([
          { userId: "mb-account", blockedUserId: "mb-made" },
        ]);
        expect(await blocksOf(db, "mb-moved-against")).toEqual([
          { userId: "mb-against", blockedUserId: "mb-account" },
        ]);
        expect(await blocksOf(db, "mb-kept-made")).toEqual([
          { userId: "mb-account", blockedUserId: "mb-repeat" },
        ]);
        expect(await blocksOf(db, "mb-kept-against")).toEqual([
          { userId: "mb-repeat", blockedUserId: "mb-account" },
        ]);
        expect(await blocksOf(db, "mb-dropped-made")).toEqual([]);
        expect(await blocksOf(db, "mb-dropped-against")).toEqual([]);
        expect(await blocksOf(db, "mb-self-made")).toEqual([]);
        expect(await blocksOf(db, "mb-self-against")).toEqual([]);
        expect(await findUserByBrowserTokenHash(db, "hash-of-mb-device")).toBeNull();
      });

      it("leaves every block alone when the merge is refused for a name given after the read", async () => {
        const stale = await insertedUser(db, "mb5-device");
        await insertUser(db, "mb5-account");
        await insertUser(db, "mb5-other");
        await insertBlock(db, {
          id: "mb5-block",
          userId: "mb5-device",
          blockedUserId: "mb5-other",
          createdAt: 0,
        });
        await insertBlock(db, {
          id: "mb5-duplicate",
          userId: "mb5-account",
          blockedUserId: "mb5-other",
          createdAt: 0,
        });
        await db
          .prepare("UPDATE users SET display_name = 'Rae', display_name_key = 'rae' WHERE id = ?")
          .bind("mb5-device")
          .run();

        expect(await mergeUserInto(db, stale, "mb5-account")).toBe(false);

        expect(await blocksOf(db, "mb5-block")).toEqual([
          { userId: "mb5-device", blockedUserId: "mb5-other" },
        ]);
        expect(await blocksOf(db, "mb5-duplicate")).toEqual([
          { userId: "mb5-account", blockedUserId: "mb5-other" },
        ]);
      });
    });
  });
});

// A user who starts a story gets the name and writes the opening passage.
async function userWhoStarted(
  db: Env["DB"],
  id: string,
  storyId: string,
  name: string | null,
): Promise<UserRow> {
  await insertUser(db, id);
  await createStory(db, {
    storyId,
    now: 1,
    state: newStoryState(),
    creator: { id: `p-${id}`, position: 0, userId: id },
    displayName: name === null ? null : { displayName: name, displayNameKey: name.toLowerCase() },
    opening: { id: `o-${id}`, text: "Once." },
  });

  return userOf(db, id);
}

async function authorsOf(db: Env["DB"], storyId: string): Promise<string[]> {
  const result = await db
    .prepare("SELECT author_id AS authorId FROM passages WHERE story_id = ?")
    .bind(storyId)
    .all();

  return z
    .array(z.object({ authorId: z.string() }))
    .parse(result.results)
    .map((row) => row.authorId);
}

async function insertedUser(db: Env["DB"], id: string): Promise<UserRow> {
  await insertUser(db, id);

  return userOf(db, id);
}

async function userOf(db: Env["DB"], id: string): Promise<UserRow> {
  const user = await findUserByBrowserTokenHash(db, `hash-of-${id}`);
  if (user === null) {
    throw new Error(`User ${id} missing`);
  }

  return user;
}

async function blocksOf(db: Env["DB"], id: string): Promise<unknown[]> {
  const result = await db
    .prepare("SELECT user_id AS userId, blocked_user_id AS blockedUserId FROM blocks WHERE id = ?")
    .bind(id)
    .all();

  return result.results;
}
