import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newStoryState } from "../src/shared/turnOrder";
import {
  addParticipant,
  appendPassage,
  createStory,
  isHeldByAnotherUser,
  loadStory,
  type Db,
} from "../src/worker/db/storyRepo";
import { findUserByDisplayNameKey } from "../src/worker/db/userRepo";
import { createTestEnv, type TestEnv } from "./support/testEnv";
import { insertUser } from "./support/users";

describe("storyRepo", () => {
  let testEnv: TestEnv;
  let emptyBatches: Db;

  beforeAll(async () => {
    testEnv = await createTestEnv();
    // A database whose batches come back with no results, as if D1 dropped them.
    emptyBatches = {
      prepare: (query) => testEnv.env.DB.prepare(query),
      batch: () => Promise.resolve([]),
    };
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("fails fast when a read batch returns fewer results than statements", async () => {
    await expect(loadStory(emptyBatches, "abc12")).rejects.toThrow(
      "D1 batch returned no result at index 0",
    );
  });

  it("fails fast when a write batch returns no result for the guarded update", async () => {
    await expect(
      appendPassage(emptyBatches, {
        storyId: "abc12",
        loadedVersion: 0,
        next: newStoryState(),
        passage: {
          id: "c",
          authorId: "u",
          text: "Hi.",
          startsParagraph: false,
          createdAt: 0,
        },
      }),
    ).rejects.toThrow("D1 batch returned no result at index 1");
  });

  it("takes a participant who has left out of the turn order but keeps their row", async () => {
    await insertUser(testEnv.env.DB, "u0");
    await insertUser(testEnv.env.DB, "u1", "Ben");
    const creator = { id: "p0", position: 0, userId: "u0" };
    await createStory(testEnv.env.DB, {
      storyId: "lv001",
      now: 1,
      state: newStoryState(),
      creator,
      displayName: { displayName: "Ana", displayNameKey: "ana" },
      opening: { id: "c0", text: "Once." },
    });
    await testEnv.env.DB.prepare(
      `INSERT INTO participants (id, story_id, position, user_id, joined_at, left_at)
       VALUES ('p1', 'lv001', 1, 'u1', 2, 3)`,
    ).run();

    const loaded = await loadStory(testEnv.env.DB, "lv001");

    expect(loaded?.participants.map(({ id }) => id)).toEqual(["p0", "p1"]);
    expect(loaded?.activeParticipants.map(({ id }) => id)).toEqual(["p0"]);
    expect(loaded?.state.participantPositions).toEqual([0]);
    expect(loaded?.nextPosition).toBe(2);
  });

  describe("a display name another user holds", () => {
    const state = newStoryState();

    it("makes createStory answer name_taken and write no story", async () => {
      await insertUser(testEnv.env.DB, "nt-holder", "Taken");
      await insertUser(testEnv.env.DB, "nt-creator");

      const result = await createStory(testEnv.env.DB, {
        storyId: "nt001",
        now: 1,
        state,
        creator: { id: "nt-p0", position: 0, userId: "nt-creator" },
        displayName: { displayName: "TAKEN", displayNameKey: "taken" },
        opening: { id: "nt-o0", text: "Once." },
      });

      expect(result).toBe("name_taken");
      expect(await loadStory(testEnv.env.DB, "nt001")).toBeNull();
    });

    it("makes addParticipant answer name_taken and add no participant", async () => {
      await insertUser(testEnv.env.DB, "aj-ana");
      await insertUser(testEnv.env.DB, "aj-ben");
      await insertUser(testEnv.env.DB, "aj-holder", "Cal");
      await createStory(testEnv.env.DB, {
        storyId: "aj001",
        now: 1,
        state,
        creator: { id: "aj-p0", position: 0, userId: "aj-ana" },
        displayName: { displayName: "Dee", displayNameKey: "dee" },
        opening: { id: "aj-o0", text: "Once." },
      });

      const result = await addParticipant(testEnv.env.DB, {
        storyId: "aj001",
        loadedVersion: 0,
        next: { ...state, turnVersion: 1 },
        participant: { id: "aj-p1", position: 1, userId: "aj-ben" },
        displayName: { displayName: "cal", displayNameKey: "cal" },
        joinedAt: 2,
      });

      expect(result).toBe("name_taken");
      const loaded = await loadStory(testEnv.env.DB, "aj001");
      expect(loaded?.participants.map(({ id }) => id)).toEqual(["aj-p0"]);
      expect(loaded?.state.turnVersion).toBe(0);
    });

    // Two overlapping requests from one unnamed user both send a name. The first names the user;
    // without this the second would be refused with name_taken against the user making it.
    it("does not count the requesting user as another holder", async () => {
      const db = testEnv.env.DB;
      await insertUser(db, "self-holder", "Mine");
      const mine = { displayName: "MINE", displayNameKey: "mine" };

      expect(await isHeldByAnotherUser(db, mine, "self-holder")).toBe(false);
      expect(await isHeldByAnotherUser(db, mine, "someone-else")).toBe(true);
      expect(await isHeldByAnotherUser(db, mine, null)).toBe(true);
      expect(await isHeldByAnotherUser(db, null, null)).toBe(false);
    });

    it("lets a user who already holds the name join with it, and keeps the name", async () => {
      const db = testEnv.env.DB;
      await insertUser(db, "sj-ana");
      await insertUser(db, "sj-ben", "Sjben");
      await createStory(db, {
        storyId: "sj001",
        now: 1,
        state,
        creator: { id: "sj-p0", position: 0, userId: "sj-ana" },
        displayName: { displayName: "Sjana", displayNameKey: "sjana" },
        opening: { id: "sj-o0", text: "Once." },
      });

      const result = await addParticipant(db, {
        storyId: "sj001",
        loadedVersion: 0,
        next: { ...state, turnVersion: 1 },
        participant: { id: "sj-p1", position: 1, userId: "sj-ben" },
        displayName: { displayName: "Sjben", displayNameKey: "sjben" },
        joinedAt: 2,
      });

      expect(result).toBe("saved");
      expect(await findUserByDisplayNameKey(db, "sjben")).toEqual({
        id: "sj-ben",
        displayName: "Sjben",
        displayNameKey: "sjben",
      });
    });
  });
});
