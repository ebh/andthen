import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TURN_WINDOW_MS } from "../src/shared/validation";
import { createApp } from "../src/worker/app";
import { loadPushSubscriptions } from "../src/worker/db/pushRepo";
import type { PushSender } from "../src/worker/push";
import { selectSessionVerifier } from "../src/worker/sessionToken";
import { fakeProvider } from "../src/worker/suggestions/fake";
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
import { userIdOf } from "./support/users";

const OPENING = "Once upon a time, in a village by the sea, a lantern went out.";
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);

const endpointOf = (name: string) => `https://fcm.googleapis.com/send/${name}`;

describe("pushing the turn", () => {
  let testEnv: TestEnv;
  let sender: FakePushSender;
  let clock: Clock;
  let app: ReturnType<typeof createTestApp>;
  let storyCount = 0;

  // The test bed's STORY_ROOM can't reach the Durable Object, so every write would log a failed
  // room notification. This room accepts and ignores them.
  let env: Env;

  beforeAll(async () => {
    testEnv = await createTestEnv();
    env = withQuietRoom(testEnv.env);
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A fresh clock, sender and app for each test. Story IDs stay unique across the file.
  function setUp(): void {
    clock = { now: T0 };
    sender = createFakePushSender();
    app = createTestApp(
      clock,
      () => {
        storyCount += 1;
        return `p${String(storyCount).padStart(4, "0")}`;
      },
      fakeProvider,
      undefined,
      sender,
    );
  }

  const newBrowser = () => createBrowser(app, env);

  const sentTo = () => sender.sent.map(({ subscription }) => subscription.endpoint);

  // Ana (position 0) wrote the opening, Ben (1) holds the turn, Cy (2) is next. None subscribed.
  async function unsubscribedWriters(target: typeof app, origin = "http://localhost") {
    const [ana, ben, cy] = [
      createBrowser(target, env, origin),
      createBrowser(target, env, origin),
      createBrowser(target, env, origin),
    ];
    const storyId = await createStory(ana, nameInTest("Ana"), OPENING);
    await joinStory(ben, storyId, nameInTest("Ben"));
    await joinStory(cy, storyId, nameInTest("Cy"));

    return { ana, ben, cy, storyId };
  }

  // The same, and everyone has one subscription; the sender has been told nothing yet.
  async function threeWriters() {
    setUp();
    const { ana, ben, cy, storyId } = await unsubscribedWriters(app);
    const endpoints = {
      ana: await subscribe(ana, "ana"),
      ben: await subscribe(ben, "ben"),
      cy: await subscribe(cy, "cy"),
    };
    await settle(ana, ben, cy);
    sender.sent.length = 0;

    return { ana, ben, cy, storyId, endpoints };
  }

  describe("when a contribution passes the turn", () => {
    it("sends the new holder a declarative push that opens the story", async () => {
      const { ben, cy, storyId, endpoints } = await threeWriters();

      const response = await contribute(ben, storyId);
      await settle(ben);

      expect(response.status).toBe(201);
      expect(sentTo()).toEqual([endpoints.cy]);
      expect(sender.sent[0]?.subscription).toEqual({
        endpoint: endpoints.cy,
        p256dh: P256DH,
        auth: AUTH,
      });
      expect(sender.sent[0]?.message).toEqual({
        data: {
          web_push: 8030,
          notification: {
            title: "Your turn",
            body: "Once upon a time, in a village by the sea, a lantern went…",
            navigate: `http://localhost/${storyId}`,
            tag: `turn-${storyId}`,
          },
        },
        topic: `turn-${storyId}`,
        ttlSeconds: TURN_WINDOW_MS / 1000,
      });
      expect(await holds(cy, storyId)).toBe(true);
    });

    it("lives for the rest of the window: the TTL counts down from the turn's start", async () => {
      const { ben, storyId } = await threeWriters();
      clock.now = T0 + 60 * 60 * 1000;

      await contribute(ben, storyId);
      await settle(ben);

      // The contribution starts Cy's window now, so it has the whole of it.
      expect(sender.sent[0]?.message.ttlSeconds).toBe(TURN_WINDOW_MS / 1000);
    });

    it("sends to the origin of the request, so a preview links to the preview", async () => {
      setUp();
      const origin = "https://andthen-preview.example.dev";
      const { ben, cy, storyId } = await unsubscribedWriters(app, origin);
      await subscribe(cy, "preview-cy");

      await contribute(ben, storyId);
      await settle(ben);

      expect(sender.sent[0]?.message.data.notification.navigate).toBe(`${origin}/${storyId}`);
    });

    it("sends to every subscription of the holder's browser, and to no one else's", async () => {
      const { ben, cy, storyId, endpoints } = await threeWriters();
      const second = await subscribe(cy, "cy-second");

      await contribute(ben, storyId);
      await settle(ben);

      expect(sentTo().toSorted()).toEqual([endpoints.cy, second].toSorted());
    });

    it("sends nothing when the new holder has no subscription, and needs no VAPID keys", async () => {
      setUp();
      const throwingSender = vi.fn<() => PushSender>(() => {
        throw new Error("no VAPID keys");
      });
      const unkeyed = createApp({
        now: () => clock.now,
        newStoryId: () => "nok01",
        suggestionProvider: () => fakeProvider,
        pushSender: throwingSender,
        sessionVerifier: selectSessionVerifier,
      });
      const { ben, storyId } = await unsubscribedWriters(unkeyed);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await contribute(ben, storyId);
      await settle(ben);

      expect(response.status).toBe(201);
      expect(throwingSender).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalledWith("Turn push failed", expect.anything());
    });

    it("sends nothing when the story goes to waiting", async () => {
      setUp();
      const [ana, ben] = [newBrowser(), newBrowser()];
      const storyId = await createStory(ana);
      await joinStory(ben, storyId, nameInTest("Ben"));
      await subscribe(ana, "ana");

      // Ben is the only other writer and Ana wrote last, so when Ben leaves nobody can hold it.
      await ben.post(`/api/stories/${storyId}/leave`, {});
      await settle(ben);

      expect(await isWaiting(ana, storyId)).toBe(true);
      expect(sender.sent).toEqual([]);
    });
  });

  describe("when a write leaves the turn with the same person", () => {
    it("sends nothing for a join", async () => {
      const { storyId } = await threeWriters();
      const dan = newBrowser();

      await joinStory(dan, storyId, nameInTest("Dan"));
      await settle(dan);

      expect(sender.sent).toEqual([]);
    });

    it("sends nothing when someone who isn't the holder leaves", async () => {
      const { cy, storyId } = await threeWriters();

      await cy.post(`/api/stories/${storyId}/leave`, {});
      await settle(cy);

      expect(sender.sent).toEqual([]);
    });

    it("sends nothing for a rejoin that doesn't take the turn", async () => {
      const { ana, cy, storyId } = await threeWriters();
      await cy.post(`/api/stories/${storyId}/leave`, {});
      await settle(cy);

      await cy.post(`/api/stories/${storyId}/rejoin`, {});
      await settle(cy);

      expect(sender.sent).toEqual([]);
      expect(ana.cookies.size).toBe(1);
    });

    it("does not count a lapsed turn as handed over by an unrelated change", async () => {
      const { storyId, endpoints } = await threeWriters();
      // Ben's window lapses: the stored holder is Ben, but the turn is now Cy's.
      clock.now = T0 + TURN_WINDOW_MS + 1000;
      const dan = newBrowser();

      await joinStory(dan, storyId, nameInTest("Dan"));
      await settle(dan);

      expect(sentTo()).not.toContain(endpoints.cy);
      expect(sender.sent).toEqual([]);
    });
  });

  describe("when the requester is the one who gets the turn", () => {
    it("sends a joiner who starts a waiting story nothing, though their browser has subscriptions", async () => {
      setUp();
      const [ana, ben] = [newBrowser(), newBrowser()];
      // Ben already has a subscription from another story he is in.
      await createStory(ben, nameInTest("Ben"));
      await subscribe(ben, "ben");
      const storyId = await createStory(ana);

      await joinStory(ben, storyId, nameInTest("Ben"));
      await settle(ana, ben);

      expect(await holds(ben, storyId)).toBe(true);
      expect(sender.sent).toEqual([]);
    });

    it("sends a rejoiner who takes a waiting story nothing", async () => {
      setUp();
      const [ana, ben] = [newBrowser(), newBrowser()];
      const storyId = await createStory(ana);
      await joinStory(ben, storyId, nameInTest("Ben"));
      await subscribe(ben, "ben");
      await ben.post(`/api/stories/${storyId}/leave`, {});
      expect(await isWaiting(ana, storyId)).toBe(true);
      await settle(ana, ben);

      const response = await ben.post(`/api/stories/${storyId}/rejoin`, {});
      await settle(ben);

      expect(response.status).toBe(204);
      expect(await holds(ben, storyId)).toBe(true);
      expect(sender.sent).toEqual([]);
    });

    it("sends a skipper who takes the turn nothing", async () => {
      const { cy, storyId } = await threeWriters();

      // Ben holds, and Cy is next, so Cy skipping Ben takes the turn.
      await cy.post(`/api/stories/${storyId}/skip`, { turnVersion: await version(cy, storyId) });
      await settle(cy);

      expect(await holds(cy, storyId)).toBe(true);
      expect(sender.sent).toEqual([]);
    });
  });

  describe("for each kind of write", () => {
    it("pushes the next holder when someone else skips the holder", async () => {
      const { ana, storyId, endpoints } = await threeWriters();

      // Ben holds; Ana skips him, and the turn goes to Cy.
      await ana.post(`/api/stories/${storyId}/skip`, { turnVersion: await version(ana, storyId) });
      await settle(ana);

      expect(sentTo()).toEqual([endpoints.cy]);
    });

    it("pushes the next holder when the holder leaves", async () => {
      const { ben, storyId, endpoints } = await threeWriters();

      await ben.post(`/api/stories/${storyId}/leave`, {});
      await settle(ben);

      expect(sentTo()).toEqual([endpoints.cy]);
    });

    it("never pushes a writer who has left", async () => {
      setUp();
      const [ana, ben, cy] = [newBrowser(), newBrowser(), newBrowser()];
      const storyId = await createStory(ana);
      await joinStory(ben, storyId, nameInTest("Ben"));
      await subscribe(ben, "ben");
      await ben.post(`/api/stories/${storyId}/leave`, {});
      await settle(ana, ben);

      // The story waits with Ana alone; Cy joins and takes the turn.
      await joinStory(cy, storyId, nameInTest("Cy"));
      await settle(cy);

      expect(sender.sent).toEqual([]);
    });

    it("pushes the next holder on a leave, and no one on the leaver's rejoin", async () => {
      const { ben, storyId, endpoints } = await threeWriters();

      await ben.post(`/api/stories/${storyId}/leave`, {});
      await settle(ben);
      expect(sentTo()).toEqual([endpoints.cy]);

      await ben.post(`/api/stories/${storyId}/rejoin`, {});
      await settle(ben);
      expect(sentTo()).toEqual([endpoints.cy]);
    });
  });

  describe("when the push service or the setup fails", () => {
    it("deletes a subscription the push service reports gone (404 or 410) and keeps the rest", async () => {
      const { ben, cy, storyId, endpoints } = await threeWriters();
      const second = await subscribe(cy, "cy-second");
      const third = await subscribe(cy, "cy-third");
      sender.outcomes.set(endpoints.cy, "gone");
      sender.outcomes.set(second, "failed");

      await contribute(ben, storyId);
      await settle(ben);

      const kept = await loadPushSubscriptions(testEnv.env.DB, await userIdOf(testEnv.env.DB, cy));
      expect(kept.map(({ endpoint }) => endpoint).toSorted()).toEqual([second, third].toSorted());
    });

    it("keeps a subscription after a failed send", async () => {
      const { ben, cy, storyId, endpoints } = await threeWriters();
      sender.outcomes.set(endpoints.cy, "failed");

      await contribute(ben, storyId);
      await settle(ben);

      expect(
        await loadPushSubscriptions(testEnv.env.DB, await userIdOf(testEnv.env.DB, cy)),
      ).toHaveLength(1);
    });

    it("still answers the request, logs, and sends the rest when one send rejects", async () => {
      const { ben, cy, storyId, endpoints } = await threeWriters();
      const second = await subscribe(cy, "cy-second");
      sender.throwing.add(endpoints.cy);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await contribute(ben, storyId);
      await settle(ben);

      expect(response.status).toBe(201);
      expect(sentTo().toSorted()).toEqual([endpoints.cy, second].toSorted());
      expect(error).toHaveBeenCalledWith("Push to one subscription failed", expect.any(Error));
    });

    it("still answers the request and logs when the sender can't be built", async () => {
      setUp();
      const broken = createApp({
        now: () => clock.now,
        newStoryId: () => "nok02",
        suggestionProvider: () => fakeProvider,
        pushSender: () => {
          throw new Error("Invalid VAPID config");
        },
        sessionVerifier: selectSessionVerifier,
      });
      const { ben, cy, storyId } = await unsubscribedWriters(broken);
      await subscribe(cy, "cy");
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await contribute(ben, storyId);
      await settle(ben);

      expect(response.status).toBe(201);
      expect(error).toHaveBeenCalledWith("Turn push failed", expect.any(Error));
    });

    it("sends nothing for a write that lost the race", async () => {
      const { ben, storyId } = await threeWriters();
      const stale = await version(ben, storyId);
      await contribute(ben, storyId);
      await settle(ben);
      sender.sent.length = 0;

      const response = await ben.post(`/api/stories/${storyId}/passages`, {
        text: "Again.",
        turnVersion: stale,
        startsParagraph: false,
      });
      await settle(ben);

      expect(response.status).toBe(409);
      expect(sender.sent).toEqual([]);
    });

    it("hands the work to waitUntil, so the response doesn't wait for the push service", async () => {
      const { ben, storyId } = await threeWriters();
      const { promise: held, resolve: release } = Promise.withResolvers<undefined>();
      sender.send = async () => {
        await held;
        return "delivered";
      };
      const before = ben.backgroundWork.length;

      const response = await contribute(ben, storyId);

      expect(response.status).toBe(201);
      expect(ben.backgroundWork.length).toBeGreaterThan(before);
      release(undefined);
      await settle(ben);
    });
  });
});

// The holder writes a passage at the version their page shows.
async function contribute(browser: Browser, storyId: string): Promise<Response> {
  return browser.post(`/api/stories/${storyId}/passages`, {
    text: "And then it lit again.",
    turnVersion: await version(browser, storyId),
    startsParagraph: false,
  });
}

async function subscribe(browser: Browser, name: string): Promise<string> {
  const endpoint = endpointOf(name);
  const response = await putPushSubscription(browser, {
    endpoint,
    keys: { p256dh: P256DH, auth: AUTH },
  });
  expect(response.status).toBe(204);

  return endpoint;
}

// The app's background work (room notification, push) for the requests a browser has made.
async function settle(...browsers: Browser[]): Promise<void> {
  await Promise.all(browsers.flatMap((browser) => browser.backgroundWork.splice(0)));
}

async function version(browser: Browser, storyId: string): Promise<number> {
  return (await readStory(browser, storyId)).turn.version;
}

async function holds(browser: Browser, storyId: string): Promise<boolean> {
  const story = await readStory(browser, storyId);

  return story.turn.holderId === story.me;
}

async function isWaiting(browser: Browser, storyId: string): Promise<boolean> {
  return (await readStory(browser, storyId)).turn.holderId === null;
}

function withQuietRoom(base: Env): Env {
  const quietRoom = { getByName: () => ({ notify: () => Promise.resolve() }) };

  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, { STORY_ROOM: quietRoom });
}
