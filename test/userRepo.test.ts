import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { newStoryState } from "../src/shared/turnOrder";
import type { UserRow } from "../src/worker/db/rows";
import { createStory } from "../src/worker/db/storyRepo";
import {
  createAnonymousUser,
  findUserByBrowserTokenHash,
  findUserByDisplayNameKey,
  mergeUserInto,
} from "../src/worker/db/userRepo";
import { createTestEnv, type TestEnv } from "./support/testEnv";
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
      await db
        .prepare("UPDATE users SET display_name = 'Quin', display_name_key = 'quin' WHERE id = ?")
        .bind("m4-device")
        .run();

      expect(await mergeUserInto(db, stale, "m4-account")).toBe(false);
      expect(await authorsOf(db, "m4d01")).toEqual(["m4-device"]);
      expect((await findUserByDisplayNameKey(db, "quin"))?.id).toBe("m4-device");

      const fresh = await findUserByBrowserTokenHash(db, "hash-of-m4-device");
      if (fresh === null) {
        throw new Error("device user missing");
      }
      expect(await mergeUserInto(db, fresh, "m4-account")).toBe(true);
      expect(await authorsOf(db, "m4d01")).toEqual(["m4-account"]);
      expect((await findUserByDisplayNameKey(db, "quin"))?.id).toBe("m4-account");
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
  const user = await findUserByBrowserTokenHash(db, `hash-of-${id}`);
  if (user === null) {
    throw new Error("user missing");
  }

  return user;
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
