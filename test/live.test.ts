import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { noStore } from "../src/worker/http";
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

// A stand-in StoryRoom namespace. Node can't build a 101 response, so `fetch` answers 200.
interface FakeRooms {
  env: { DB: D1Database; STORY_ROOM: object };
  upgrades: { storyId: string; url: string }[];
  notifications: { storyId: string; version: number }[];
}

describe("GET /api/stories/:id/live", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  function fakeRooms(
    notify: (version: number) => Promise<void> = () => Promise.resolve(),
  ): FakeRooms {
    const rooms: FakeRooms = {
      env: { DB: testEnv.env.DB, STORY_ROOM: {} },
      upgrades: [],
      notifications: [],
    };
    rooms.env.STORY_ROOM = {
      getByName: (storyId: string) => ({
        fetch: (request: Request) => {
          rooms.upgrades.push({ storyId, url: request.url });
          return Promise.resolve(new Response("room"));
        },
        notify: (message: { version: number }) => {
          rooms.notifications.push({ storyId, version: message.version });
          return notify(message.version);
        },
      }),
    };

    return rooms;
  }

  const newBrowser = () => createBrowser(app, testEnv.env);
  const upgrade = { Upgrade: "websocket", Origin: "http://localhost" };

  // Ana created the story and Ben joined: both are participants.
  async function twoPersonStory(): Promise<{ ana: Browser; ben: Browser; storyId: string }> {
    clock.now = T0;
    const [ana, ben] = [newBrowser(), newBrowser()];
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");

    return { ana, ben, storyId };
  }

  describe("the guard", () => {
    it("refuses a request that isn't a WebSocket upgrade", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      const response = await ana.get(`/api/stories/${storyId}/live`, { env: rooms.env });

      expect(response.status).toBe(426);
      expect(await response.text()).toBe("Expected a WebSocket upgrade");
      expect(rooms.upgrades).toEqual([]);
    });

    it("refuses a cross-origin or origin-less upgrade", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      for (const headers of [
        { Upgrade: "websocket", Origin: "https://evil.example" },
        { Upgrade: "websocket" },
      ]) {
        const response = await ana.get(`/api/stories/${storyId}/live`, { headers, env: rooms.env });

        expect(response.status).toBe(403);
        expect(await readError(response)).toBe("forbidden_origin");
      }
      expect(rooms.upgrades).toEqual([]);
    });

    it("answers 404 for an unknown story and for text that isn't an ID", async () => {
      const ana = newBrowser();
      const rooms = fakeRooms();

      for (const id of ["zzzzz", "abc-1"]) {
        const response = await ana.get(`/api/stories/${id}/live`, {
          headers: upgrade,
          env: rooms.env,
        });

        expect(response.status).toBe(404);
        expect(await readError(response)).toBe("not_found");
      }
      expect(rooms.upgrades).toEqual([]);
    });

    it("refuses a browser that isn't in the story, with or without a cookie", async () => {
      const { storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const stranger = newBrowser();

      const response = await stranger.get(`/api/stories/${storyId}/live`, {
        headers: upgrade,
        env: rooms.env,
      });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
      expect(rooms.upgrades).toEqual([]);
    });

    it("checks the Origin before looking at who is asking", async () => {
      const { storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const stranger = newBrowser();

      const response = await stranger.get(`/api/stories/${storyId}/live`, {
        headers: { Upgrade: "websocket", Origin: "https://evil.example" },
        env: rooms.env,
      });

      expect(await readError(response)).toBe("forbidden_origin");
    });

    it("accepts the Upgrade header in any case", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      const response = await ana.get(`/api/stories/${storyId}/live`, {
        headers: { Upgrade: "WebSocket", Origin: "http://localhost" },
        env: rooms.env,
      });

      expect(await response.text()).toBe("room");
    });

    it("forwards a participant's upgrade to that story's room, case-insensitively", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      const response = await ana.get(`/api/stories/${storyId.toUpperCase()}/live`, {
        headers: upgrade,
        env: rooms.env,
      });

      expect(await response.text()).toBe("room");
      expect(rooms.upgrades).toHaveLength(1);
      expect(rooms.upgrades[0]?.storyId).toBe(storyId);
    });
  });

  describe("notifying the room", () => {
    it("sends the new turn version after a join, a contribution and a skip", async () => {
      const { ana, ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const carol = newBrowser();

      await carol.post(
        `/api/stories/${storyId}/participants`,
        { displayName: "Carol" },
        {
          env: rooms.env,
        },
      );
      const version = (await readStory(ben, storyId)).turn.version;
      await ben.post(
        `/api/stories/${storyId}/contributions`,
        { text: "Then.", turnVersion: version },
        { env: rooms.env },
      );
      const afterWrite = (await readStory(ana, storyId)).turn.version;
      await ana.post(
        `/api/stories/${storyId}/skip`,
        { turnVersion: afterWrite },
        {
          env: rooms.env,
        },
      );

      expect(rooms.notifications.map((n) => n.storyId)).toEqual([storyId, storyId, storyId]);
      expect(rooms.notifications.map((n) => n.version)).toEqual([
        version,
        afterWrite,
        afterWrite + 1,
      ]);
    });

    it("sends nothing for a write that was refused", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      const response = await ben.post(
        `/api/stories/${storyId}/contributions`,
        { text: "Too late.", turnVersion: 99 },
        { env: rooms.env },
      );

      expect(response.status).toBe(409);
      expect(rooms.notifications).toEqual([]);
    });

    it("sends nothing for a join that lost a race", async () => {
      const { storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const env = { ...rooms.env, DB: gateLoads(testEnv.env.DB, 2) };
      const joiners = ["Carol", "Dee"].map((displayName) => ({
        displayName,
        browser: newBrowser(),
      }));

      const responses = await Promise.all(
        joiners.map(({ browser, displayName }) =>
          browser.post(`/api/stories/${storyId}/participants`, { displayName }, { env }),
        ),
      );

      expect(responses.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([201, 409]);
      expect(rooms.notifications).toHaveLength(1);
    });

    it("sends nothing for a skip that lost a race", async () => {
      const { ana, storyId } = await twoPersonStory();
      const carol = newBrowser();
      await joinStory(carol, storyId, "Carol");
      const version = (await readStory(ana, storyId)).turn.version;
      const rooms = fakeRooms();
      const env = { ...rooms.env, DB: gateLoads(testEnv.env.DB, 2) };

      const responses = await Promise.all(
        [ana, carol].map((browser) =>
          browser.post(`/api/stories/${storyId}/skip`, { turnVersion: version }, { env }),
        ),
      );

      expect(responses.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([204, 409]);
      expect(rooms.notifications).toHaveLength(1);
    });

    it("still answers the write when the room throws, and logs it", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms(() => {
        throw new Error("room down");
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const version = (await readStory(ben, storyId)).turn.version;

      const response = await ben.post(
        `/api/stories/${storyId}/contributions`,
        { text: "Still saved.", turnVersion: version },
        { env: rooms.env },
      );
      await Promise.all(ben.backgroundWork);

      expect(response.status).toBe(204);
      expect(log).toHaveBeenCalledWith("StoryRoom notify failed", expect.any(Error));
      expect((await readStory(ben, storyId)).contributions.map((c) => c.text)).toContain(
        "Still saved.",
      );
      log.mockRestore();
    });

    it("still answers the write when the room rejects, and logs it", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms(() => Promise.reject(new Error("room unreachable")));
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const version = (await readStory(ben, storyId)).turn.version;

      const response = await ben.post(
        `/api/stories/${storyId}/contributions`,
        { text: "Still saved.", turnVersion: version },
        { env: rooms.env },
      );
      await Promise.all(ben.backgroundWork);

      expect(response.status).toBe(204);
      expect(log).toHaveBeenCalledWith("StoryRoom notify failed", expect.any(Error));
      log.mockRestore();
    });

    it("answers the write without waiting for a room that never answers", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms(() => new Promise(() => undefined));
      const version = (await readStory(ben, storyId)).turn.version;

      const response = await ben.post(
        `/api/stories/${storyId}/contributions`,
        { text: "Saved anyway.", turnVersion: version },
        { env: rooms.env },
      );

      expect(response.status).toBe(204);
      expect(rooms.notifications).toHaveLength(1);
      // The notification is handed to waitUntil and still pending; the write is committed.
      const notification = ben.backgroundWork.at(-1);
      expect(await Promise.race([notification, Promise.resolve("still pending")])).toBe(
        "still pending",
      );
      expect((await readStory(ben, storyId)).contributions.map((c) => c.text)).toContain(
        "Saved anyway.",
      );
    });
  });
});

describe("noStore", () => {
  // Pins the 101 branch: a WebSocket upgrade response has immutable headers in workerd, so the
  // middleware must not touch them. Node can't build a 101 Response, so one is faked.
  it("leaves a WebSocket upgrade response alone and marks every other response no-store", async () => {
    const app = new Hono();
    app.use("*", noStore);
    app.get("/upgrade", () => {
      const response = new Response(null);
      Object.defineProperty(response, "status", { value: 101 });
      return response;
    });
    app.get("/plain", (c) => c.text("hi"));

    const upgraded = await app.request("/upgrade");
    const plain = await app.request("/plain");

    // Touching the headers of a 101 throws, which Hono answers with a 500.
    expect(upgraded.status).toBe(101);
    expect(upgraded.headers.get("Cache-Control")).toBeNull();
    expect(plain.headers.get("Cache-Control")).toBe("no-store");
  });
});
