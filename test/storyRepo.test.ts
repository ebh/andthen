import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newStoryState } from "../src/shared/turnOrder";
import { appendContribution, createStory, loadStory, type Db } from "../src/worker/db/storyRepo";
import { createTestEnv, type TestEnv } from "./support/testEnv";

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
      appendContribution(emptyBatches, {
        storyId: "abc12",
        loadedVersion: 0,
        next: newStoryState(),
        contribution: {
          id: "c",
          participantId: "p",
          text: "Hi.",
          startsParagraph: false,
          createdAt: 0,
        },
      }),
    ).rejects.toThrow("D1 batch returned no result at index 1");
  });

  it("takes a participant who has left out of the turn order but keeps their row", async () => {
    const creator = {
      id: "p0",
      displayName: "Ana",
      displayNameKey: "ana",
      position: 0,
      browserTokenHash: "h0",
    };
    await createStory(testEnv.env.DB, {
      storyId: "lv001",
      now: 1,
      state: newStoryState(),
      creator,
      opening: { id: "c0", text: "Once." },
    });
    await testEnv.env.DB.prepare(
      `INSERT INTO participants (id, story_id, display_name, display_name_key, position,
         browser_token_hash, joined_at, left_at) VALUES ('p1', 'lv001', 'Ben', 'ben', 1, 'h1', 2, 3)`,
    ).run();

    const loaded = await loadStory(testEnv.env.DB, "lv001");

    expect(loaded?.participants.map(({ id }) => id)).toEqual(["p0", "p1"]);
    expect(loaded?.activeParticipants.map(({ id }) => id)).toEqual(["p0"]);
    expect(loaded?.state.participantPositions).toEqual([0]);
    expect(loaded?.nextPosition).toBe(2);
  });
});
