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
const OPENING_EXCERPT = "Once upon a time, in a village by the sea, a lantern went…";
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
  async function threeWriters(origin = "http://localhost") {
    setUp();
    const { ana, ben, cy, storyId } = await unsubscribedWriters(app, origin);
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
    it("sends the new holder's every subscription a declarative push that opens the story on the request's origin", async () => {
      // A preview origin, so a hard-coded origin in the link would fail.
      const origin = "https://andthen-preview.example.dev";
      const { ben, cy, storyId, endpoints } = await threeWriters(origin);
      const second = await subscribe(cy, "cy-second");

      // A later clock pins that the lifetime counts from the turn the write saved, not the turn it loaded.
      clock.now = T0 + 60 * 60 * 1000;
      const response = await contribute(ben, storyId);
      await settle(ben);

      expect(response.status).toBe(201);
      // Both of the holder's subscriptions, and no one else's.
      expect(sentTo().toSorted()).toEqual([endpoints.cy, second].toSorted());
      for (const { subscription, message } of sender.sent) {
        expect(subscription).toEqual({
          endpoint: subscription.endpoint,
          p256dh: P256DH,
          auth: AUTH,
        });
        expect(message).toEqual({
          data: {
            web_push: 8030,
            notification: {
              title: "Your turn",
              body: "Once upon a time, in a village by the sea, a lantern went…",
              navigate: `${origin}/${storyId}`,
              tag: `turn-${storyId}`,
            },
          },
          topic: `turn-${storyId}`,
          ttlSeconds: TURN_WINDOW_MS / 1000,
        });
      }
      expect(await holds(cy, storyId)).toBe(true);
    });

    // Pins that only the holder's own block of the opening's author silences the quote: other
    // blocks leave it in, and a holder who blocks the author gets a push that quotes none of it.
    // Without it a blocked author's words would reach the holder's lock screen.
    it("quotes the opening unless the holder blocks its author", async () => {
      const { ana, ben, cy, storyId } = await threeWriters();
      // Ben blocks the author, and Cy blocks someone else; neither is the holder with a block.
      await block(ben, await userIdOf(env.DB, ana));
      await block(cy, await userIdOf(env.DB, ben));

      await contribute(ben, storyId);
      await settle(ben);
      expect(sender.sent[0]?.message.data.notification.body).toBe(OPENING_EXCERPT);

      await contribute(cy, storyId);
      await settle(cy);
      sender.sent.length = 0;
      await contribute(ana, storyId);
      await settle(ana);
      // Ben holds after Ana's turn, and blocks the opening's author.
      expect(sender.sent).toHaveLength(1);
      expect(sender.sent[0]?.message.data.notification).toEqual({
        title: "Your turn",
        body: "",
        navigate: `http://localhost/${storyId}`,
        tag: `turn-${storyId}`,
      });
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
  });

  describe("for each kind of write", () => {
    it("pushes the next holder when someone else skips the holder", async () => {
      const { ana, storyId, endpoints } = await threeWriters();

      // Ben holds; Ana skips him, and the turn goes to Cy.
      await ana.post(`/api/stories/${storyId}/skip`, { turnVersion: await version(ana, storyId) });
      await settle(ana);

      expect(sentTo()).toEqual([endpoints.cy]);
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

    it("builds the sender only for a holder who subscribed, and still answers when it can't be built", async () => {
      setUp();
      const throwingSender = vi.fn<() => PushSender>(() => {
        throw new Error("Invalid VAPID config");
      });
      const broken = createApp({
        now: () => clock.now,
        newStoryId: () => "nok02",
        suggestionProvider: () => fakeProvider,
        pushSender: throwingSender,
        sessionVerifier: selectSessionVerifier,
      });
      const { ana, ben, cy, storyId } = await unsubscribedWriters(broken);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      // Cy has no subscription: the sender is never built, so a missing VAPID config is no error.
      const unsubscribed = await contribute(ben, storyId);
      await settle(ben);

      expect(unsubscribed.status).toBe(201);
      expect(throwingSender).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalledWith("Turn push failed", expect.anything());

      // Cy's contribution hands the turn to Ana, who subscribed.
      await subscribe(ana, "ana");
      const subscribed = await contribute(cy, storyId);
      await settle(cy);

      expect(subscribed.status).toBe(201);
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

async function block(browser: Browser, blockedUserId: string): Promise<void> {
  const response = await browser.post("/api/users/me/blocks", { blockedUserId });
  expect(response.status).toBe(201);
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

function withQuietRoom(base: Env): Env {
  const quietRoom = { getByName: () => ({ notify: () => Promise.resolve() }) };

  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, { STORY_ROOM: quietRoom });
}
