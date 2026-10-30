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

  function fakeRooms(notify: (version: number) => void = () => undefined): FakeRooms {
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
          notify(message.version);
          return Promise.resolve();
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

      expect(response.status).toBe(204);
      expect(log).toHaveBeenCalledWith("StoryRoom notify failed", expect.any(Error));
      expect((await readStory(ben, storyId)).contributions.map((c) => c.text)).toContain(
        "Still saved.",
      );
      log.mockRestore();
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
