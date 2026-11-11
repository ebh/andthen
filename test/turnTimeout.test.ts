import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TURN_WINDOW_MS } from "../src/shared/validation";
import type { Db } from "../src/worker/db/storyRepo";
import { passTimedOutTurn } from "../src/worker/turnTimeout";
import {
  createBrowser,
  createStory,
  createTestApp,
  joinStory,
  readStory,
  T0,
  type Browser,
  type Clock,
  nameInTest,
} from "./support/browser";
import { putPushSubscription } from "./support/pushSubscriptions";
import { createFakePushSender, type FakePushSender } from "./support/fakePushSender";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const OPENING = "Once upon a time, in a village by the sea, a lantern went out.";
const ORIGIN = "https://app.example.test";
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const LAPSED = T0 + TURN_WINDOW_MS + 1000;

describe("passTimedOutTurn", () => {
  let testEnv: TestEnv;
  let storyCount = 0;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  function newApp() {
    const clock: Clock = { now: T0 };
    storyCount += 1;

    return createTestApp(clock, () => `t${String(storyCount).padStart(4, "0")}`);
  }

  // Ana (0) wrote the opening, Ben (1) holds the turn from T0, Cy (2) is next.
  async function story() {
    const app = newApp();
    const env = quietRoom(testEnv.env);
    const ana = createBrowser(app, env);
    const ben = createBrowser(app, env);
    const cy = createBrowser(app, env);
    const storyId = await createStory(ana, nameInTest("Ana"), OPENING);
    await joinStory(ben, storyId, nameInTest("Ben"));
    await joinStory(cy, storyId, nameInTest("Cy"));

    return { ben, cy, storyId, sender: createFakePushSender() };
  }

  function fire(storyId: string, sender: FakePushSender, now: number, db: Db = testEnv.env.DB) {
    return passTimedOutTurn(db, () => sender, { storyId, origin: ORIGIN, now });
  }

  it("saves the turn the expiry produced and pushes the writer it landed on", async () => {
    const { cy, storyId, sender } = await story();
    const endpoint = await subscribe(cy, "cy");
    const before = (await readStory(cy, storyId)).turn;

    const outcome = await fire(storyId, sender, LAPSED);

    const after = await readStory(cy, storyId);
    expect(outcome).toEqual({
      newTurnVersion: before.version + 1,
      nextDeadline: T0 + 2 * TURN_WINDOW_MS,
    });
    expect(after.turn.holderId).toBe(after.me);
    expect(after.turn.version).toBe(before.version + 1);
    expect(sender.sent.map(({ subscription }) => subscription.endpoint)).toEqual([endpoint]);
    expect(sender.sent[0]?.message.data.notification.navigate).toBe(`${ORIGIN}/${storyId}`);
    expect(sender.sent[0]?.message.ttlSeconds).toBe((T0 + 2 * TURN_WINDOW_MS - LAPSED) / 1000);
  });

  it("does nothing the second time it fires", async () => {
    const { cy, storyId, sender } = await story();
    await subscribe(cy, "cy-again");
    await fire(storyId, sender, LAPSED);
    sender.sent.length = 0;

    const outcome = await fire(storyId, sender, LAPSED + 1000);

    expect(outcome).toEqual({ newTurnVersion: null, nextDeadline: T0 + 2 * TURN_WINDOW_MS });
    expect(sender.sent).toEqual([]);
  });

  it("writes and pushes nothing before the deadline, and returns the real deadline", async () => {
    const { cy, storyId, sender } = await story();
    await subscribe(cy, "cy-early");
    const before = (await readStory(cy, storyId)).turn.version;

    const outcome = await fire(storyId, sender, T0 + TURN_WINDOW_MS - 1);

    expect(outcome).toEqual({ newTurnVersion: null, nextDeadline: T0 + TURN_WINDOW_MS });
    expect((await readStory(cy, storyId)).turn.version).toBe(before);
    expect(sender.sent).toEqual([]);
  });

  it("does nothing for a story that waits, and for an unknown story", async () => {
    const solo = createBrowser(newApp(), quietRoom(testEnv.env));
    const storyId = await createStory(solo, nameInTest("Ana"), OPENING);
    const sender = createFakePushSender();

    expect(await fire(storyId, sender, LAPSED)).toEqual({
      newTurnVersion: null,
      nextDeadline: null,
    });
    expect(await fire("nosuchstory", sender, LAPSED)).toEqual({
      newTurnVersion: null,
      nextDeadline: null,
    });
    expect((await readStory(solo, storyId)).turn.holderId).toBeNull();
    expect(sender.sent).toEqual([]);
  });

  it("writes and pushes nothing when a write wins the version guard, and returns its deadline", async () => {
    const { ben, cy, storyId, sender } = await story();
    await subscribe(cy, "cy-race");
    let loads = 0;
    const racing: Db = {
      prepare: (query) => testEnv.env.DB.prepare(query),
      batch: async <T>(statements: D1PreparedStatement[]) => {
        const results = await testEnv.env.DB.batch<T>(statements);
        loads += 1;
        if (loads === 1) {
          const version = (await readStory(ben, storyId)).turn.version;
          const written = await ben.post(`/api/stories/${storyId}/passages`, {
            text: "Just in time.",
            turnVersion: version,
            startsParagraph: false,
          });
          if (written.status !== 201) {
            throw new Error(`Competing write answered ${String(written.status)}`);
          }
        }

        return results;
      },
    };

    const outcome = await fire(storyId, sender, LAPSED, racing);

    // Ben's contribution handed the turn to Cy at T0, a fresh window from then.
    expect(outcome).toEqual({ newTurnVersion: null, nextDeadline: T0 + TURN_WINDOW_MS });
    expect(sender.sent).toEqual([]);
  });

  it("saves the turn without pushing when the new holder has no subscription", async () => {
    const { storyId, sender } = await story();

    const outcome = await fire(storyId, sender, LAPSED);

    expect(outcome.newTurnVersion).not.toBeNull();
    expect(sender.sent).toEqual([]);
  });

  it("sends no push when several lapsed windows bring the turn back to its holder", async () => {
    const { ben, storyId, sender } = await story();
    await subscribe(ben, "ben-many");
    const before = (await readStory(ben, storyId)).turn.version;

    // Ben, then Cy (Ana wrote last, so is passed over), then Ben again.
    const outcome = await fire(storyId, sender, T0 + 2 * TURN_WINDOW_MS + 1000);

    expect(outcome).toEqual({
      newTurnVersion: before + 2,
      nextDeadline: T0 + 3 * TURN_WINDOW_MS,
    });
    expect(sender.sent).toEqual([]);
  });
});

async function subscribe(browser: Browser, name: string): Promise<string> {
  const endpoint = `https://fcm.googleapis.com/send/${name}`;
  const response = await putPushSubscription(browser, {
    endpoint,
    keys: { p256dh: P256DH, auth: AUTH },
  });
  expect(response.status).toBe(204);

  return endpoint;
}

function quietRoom(base: Env): Env {
  const room = { getByName: () => ({ notify: () => Promise.resolve() }) };

  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, { STORY_ROOM: room });
}
