import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newStoryState } from "../src/shared/turnOrder";
import { appendContribution, loadStory, type Db } from "../src/worker/db/storyRepo";
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
        contribution: { id: "c", participantId: "p", text: "Hi.", createdAt: 0 },
      }),
    ).rejects.toThrow("D1 batch returned no result at index 1");
  });
});
