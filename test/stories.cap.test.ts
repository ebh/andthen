import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newStoryState } from "../src/shared/turnOrder";
import { MAX_PARTICIPANTS } from "../src/shared/validation";
import { addParticipant, loadStory } from "../src/worker/db/storyRepo";
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
} from "./support/browser";
import { gateLoads } from "./support/gatedDb";
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("the participant cap", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  const newBrowser = () => createBrowser(app, testEnv.env);

  // Ana creates the story; joiners "P1", "P2", ... follow until it holds `count` participants.
  async function storyWithParticipants(count: number): Promise<{ ana: Browser; storyId: string }> {
    clock.now = T0;
    const ana = newBrowser();
    const storyId = await createStory(ana);
    for (let index = 1; index < count; index += 1) {
      await joinStory(newBrowser(), storyId, `P${String(index)}`);
    }

    return { ana, storyId };
  }

  it("caps a story at 50 participants", () => {
    expect(MAX_PARTICIPANTS).toBe(50);
  });

  it("lets the 50th participant join and refuses the 51st with 409 story_full", async () => {
    const { ana, storyId } = await storyWithParticipants(MAX_PARTICIPANTS - 1);

    const fiftieth = await newBrowser().post(joinPath(storyId), { displayName: "Last" });
    const fiftyFirst = await newBrowser().post(joinPath(storyId), { displayName: "Late" });

    expect(fiftieth.status).toBe(201);
    expect(fiftyFirst.status).toBe(409);
    expect(await readError(fiftyFirst)).toBe("story_full");
    expect((await readStory(ana, storyId)).participants).toHaveLength(MAX_PARTICIPANTS);
  });

  it("changes nothing when a join is refused: no participant, no version bump, no notification", async () => {
    const { ana, storyId } = await storyWithParticipants(MAX_PARTICIPANTS);
    const before = await readStory(ana, storyId);
    const notified: number[] = [];
    const env = {
      DB: testEnv.env.DB,
      STORY_ROOM: {
        getByName: () => ({
          notify: (message: { version: number }) => {
            notified.push(message.version);
            return Promise.resolve();
          },
        }),
      },
    };
    const late = newBrowser();

    const response = await late.post(joinPath(storyId), { displayName: "Late" }, { env });

    expect(response.status).toBe(409);
    expect(await readStory(ana, storyId)).toEqual(before);
    expect(notified).toEqual([]);
    expect(late.backgroundWork).toEqual([]);
  });

  it("reports name_taken, not story_full, for a duplicate name on a full story", async () => {
    const { storyId } = await storyWithParticipants(MAX_PARTICIPANTS);

    const response = await newBrowser().post(joinPath(storyId), { displayName: "p1" });

    expect(response.status).toBe(409);
    expect(await readError(response)).toBe("name_taken");
  });

  it("reports already_joined, not story_full, to a participant who joins again", async () => {
    const { ana, storyId } = await storyWithParticipants(MAX_PARTICIPANTS);

    const response = await ana.post(joinPath(storyId), { displayName: "Again" });

    expect(await readError(response)).toBe("already_joined");
  });

  it("still lets participants read and write in a full story", async () => {
    const { ana, storyId } = await storyWithParticipants(MAX_PARTICIPANTS);

    const view = await readStory(ana, storyId);

    expect(view.participants).toHaveLength(MAX_PARTICIPANTS);
    expect(view.turn.holderId).toBe(view.participants[1]?.id);
  });

  // The turn_version guard already makes the second join lose, so this pins the route-level result
  // of that loss: the batch writes nothing, the re-read says story_full, and the room hears once.
  it("lets only one of two joins at 49 take the last place; the other gets story_full", async () => {
    const { ana, storyId } = await storyWithParticipants(MAX_PARTICIPANTS - 1);
    const before = await readStory(ana, storyId);
    const notified: number[] = [];
    const STORY_ROOM = {
      getByName: () => ({
        notify: (message: { version: number }) => {
          notified.push(message.version);
          return Promise.resolve();
        },
      }),
    };
    const gate = { env: { DB: gateLoads(testEnv.env.DB, 2), STORY_ROOM } };
    const names = ["Zed", "Zoe"];
    const browsers = names.map(() => newBrowser());

    const responses = await Promise.all(
      names.map((displayName, index) =>
        (browsers[index] ?? newBrowser()).post(joinPath(storyId), { displayName }, gate),
      ),
    );

    expect(responses.map((response) => response.status).toSorted((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    const winnerIndex = responses.findIndex((response) => response.status === 201);
    const loserIndex = 1 - winnerIndex;
    expect(await readError(responses[loserIndex] ?? new Response())).toBe("story_full");
    const after = await readStory(ana, storyId);
    expect(after.participants).toHaveLength(MAX_PARTICIPANTS);
    expect(after.participants[MAX_PARTICIPANTS - 1]?.displayName).toBe(names[winnerIndex]);
    expect(after.participants.map((p) => p.displayName)).not.toContain(names[loserIndex]);
    expect(after.turn.version).toBe(before.turn.version + 1);
    expect(notified).toEqual([after.turn.version]);
    expect(browsers[loserIndex]?.backgroundWork).toEqual([]);
  });

  describe("addParticipant", () => {
    // The route checks the count first, and the version here is current, so only the SQL count
    // guard stands between this call and a 51st participant. Deleting it fails this test.
    it("refuses a 51st participant and leaves the turn untouched", async () => {
      const { storyId } = await storyWithParticipants(MAX_PARTICIPANTS);
      const loaded = await loadStory(testEnv.env.DB, storyId);
      if (loaded === null) {
        throw new Error("story missing");
      }

      const saved = await addParticipant(testEnv.env.DB, {
        storyId,
        loadedVersion: loaded.state.turnVersion,
        next: { ...newStoryState(), turnVersion: loaded.state.turnVersion + 1 },
        participant: {
          id: "extra",
          displayName: "Extra",
          displayNameKey: "extra",
          position: MAX_PARTICIPANTS,
          browserTokenHash: "extra-hash",
        },
        joinedAt: T0,
      });

      expect(saved).toBe(false);
      const after = await loadStory(testEnv.env.DB, storyId);
      expect(after?.participants).toHaveLength(MAX_PARTICIPANTS);
      expect(after?.state).toEqual(loaded.state);
    });
  });
});

function joinPath(storyId: string): string {
  return `/api/stories/${storyId}/participants`;
}
