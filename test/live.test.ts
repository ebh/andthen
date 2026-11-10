import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TURN_WINDOW_MS } from "../src/shared/validation";
import { noStore } from "../src/worker/http";
import type { RoomTimer } from "../src/worker/live";
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
  nameInTest,
} from "./support/browser";
import { gateLoads } from "./support/gatedDb";
import { signSessionToken } from "./support/sessionToken";
import { createTestEnv, type TestEnv } from "./support/testEnv";

// A stand-in StoryRoom namespace. Node can't build a 101 response, so `fetch` answers 200.
interface FakeRooms {
  env: { DB: D1Database; STORY_ROOM: object; CLERK_JWT_KEY: string };
  upgrades: { storyId: string; url: string; subprotocol: string | null }[];
  notifications: { storyId: string; version: number; timer: RoomTimer }[];
}

describe("GET /api/stories/:storyId/live", () => {
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
      env: { DB: testEnv.env.DB, STORY_ROOM: {}, CLERK_JWT_KEY: testEnv.env.CLERK_JWT_KEY },
      upgrades: [],
      notifications: [],
    };
    rooms.env.STORY_ROOM = {
      getByName: (storyId: string) => ({
        fetch: (request: Request) => {
          rooms.upgrades.push({
            storyId,
            url: request.url,
            subprotocol: request.headers.get("Sec-WebSocket-Protocol"),
          });
          return Promise.resolve(new Response("room"));
        },
        notify: (message: { version: number }, timer: RoomTimer) => {
          rooms.notifications.push({ storyId, version: message.version, timer });
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
    await joinStory(ben, storyId, nameInTest("Ben"));

    return { ana, ben, storyId };
  }

  async function signedInStory(clerkUserId: string) {
    const ana = createBrowser(app, testEnv.env);
    ana.sessionToken = await signSessionToken(clerkUserId, "http://localhost");
    const storyId = await createStory(ana);

    return { storyId, token: ana.sessionToken };
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

  describe("the session token in the subprotocols", () => {
    it("lets a signed-in participant in on a token alone, and keeps the token from the room", async () => {
      const { storyId, token } = await signedInStory("user_live");
      const rooms = fakeRooms();

      const response = await newBrowser().get(`/api/stories/${storyId}/live`, {
        headers: { ...upgrade, "Sec-WebSocket-Protocol": `andthen-live, ${token}` },
        env: rooms.env,
      });

      expect(await response.text()).toBe("room");
      expect(rooms.upgrades.map((u) => u.subprotocol)).toEqual(["andthen-live"]);
    });

    it("lets an anonymous participant in with andthen-live alone", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      const response = await ana.get(`/api/stories/${storyId}/live`, {
        headers: { ...upgrade, "Sec-WebSocket-Protocol": "andthen-live" },
        env: rooms.env,
      });

      expect(await response.text()).toBe("room");
      expect(rooms.upgrades.map((u) => u.subprotocol)).toEqual(["andthen-live"]);
    });

    it("sends the room no subprotocol when the client offered none", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      await ana.get(`/api/stories/${storyId}/live`, { headers: upgrade, env: rooms.env });

      expect(rooms.upgrades.map((u) => u.subprotocol)).toEqual([null]);
    });

    it("refuses a bad token with 401 and never falls back to the cookie", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const expired = await signSessionToken("user_live", "http://localhost", {
        expiresInSeconds: -120,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const response = await ana.get(`/api/stories/${storyId}/live`, {
        headers: { ...upgrade, "Sec-WebSocket-Protocol": `andthen-live, ${expired}` },
        env: rooms.env,
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer error="invalid_token"');
      expect(await readError(response)).toBe("invalid_session_token");
      expect(rooms.upgrades).toEqual([]);
      warn.mockRestore();
    });

    it("refuses a token with no azp claim", async () => {
      const { ana, storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const noAzp = await signSessionToken("user_live", "http://localhost", {
        omitAuthorizedParty: true,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const response = await ana.get(`/api/stories/${storyId}/live`, {
        headers: { ...upgrade, "Sec-WebSocket-Protocol": `andthen-live, ${noAzp}` },
        env: rooms.env,
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer error="invalid_token"');
      expect(rooms.upgrades).toEqual([]);
      warn.mockRestore();
    });

    it("refuses a token that names someone who is not in the story", async () => {
      const { storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const token = await signSessionToken("user_outsider", "http://localhost");

      const response = await newBrowser().get(`/api/stories/${storyId}/live`, {
        headers: { ...upgrade, "Sec-WebSocket-Protocol": `andthen-live, ${token}` },
        env: rooms.env,
      });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
    });

    it("ignores subprotocols on a request that is not an upgrade", async () => {
      const response = await newBrowser().get("/api/stories", {
        headers: { "Sec-WebSocket-Protocol": "andthen-live, not-a-token" },
      });

      expect(response.status).toBe(200);
    });
  });

  describe("notifying the room", () => {
    it("sends the new turn version after a join, a contribution and a skip", async () => {
      const { ana, ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const carol = newBrowser();

      await carol.post(
        `/api/stories/${storyId}/participants`,
        { displayName: nameInTest("Carol") },
        {
          env: rooms.env,
        },
      );
      const version = (await readStory(ben, storyId)).turn.version;
      await ben.post(
        `/api/stories/${storyId}/passages`,
        { text: "Then.", turnVersion: version, startsParagraph: false },
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

    it("sends the saved turn's deadline, the story and the origin with every kind of write", async () => {
      const { ana, ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const env = { env: rooms.env };
      const post = (browser: Browser, path: string, body: object) =>
        browser.post(`/api/stories/${storyId}/${path}`, body, env);
      const carol = newBrowser();

      // A join keeps the running turn, so its deadline stays Ben's.
      clock.now = T0 + 1000;
      await post(carol, "participants", { displayName: nameInTest("Carol") });
      // A contribution starts the next writer's window now.
      clock.now = T0 + 2000;
      await post(ben, "passages", {
        text: "Then.",
        turnVersion: (await readStory(ben, storyId)).turn.version,
        startsParagraph: false,
      });
      // A skip does too.
      clock.now = T0 + 3000;
      await post(ana, "skip", { turnVersion: (await readStory(ana, storyId)).turn.version });
      // A leave and a rejoin by a writer who isn't the holder keep it.
      clock.now = T0 + 4000;
      await post(ben, "leave", {});
      await post(ben, "rejoin", {});

      expect(rooms.notifications.map((n) => n.timer)).toEqual(
        [
          T0 + TURN_WINDOW_MS,
          T0 + 2000 + TURN_WINDOW_MS,
          T0 + 3000 + TURN_WINDOW_MS,
          T0 + 3000 + TURN_WINDOW_MS,
          T0 + 3000 + TURN_WINDOW_MS,
        ].map((deadline) => ({ storyId, origin: "http://localhost", deadline })),
      );
    });

    it("sends no deadline when the write leaves the story waiting", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      // Ana wrote last, so with Ben gone nobody can hold the turn.
      await ben.post(`/api/stories/${storyId}/leave`, {}, { env: rooms.env });

      expect(rooms.notifications.map((n) => n.timer.deadline)).toEqual([null]);
    });

    it("sends nothing for a write that was refused", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms();

      const response = await ben.post(
        `/api/stories/${storyId}/passages`,
        { text: "Too late.", turnVersion: 99, startsParagraph: false },
        { env: rooms.env },
      );

      expect(response.status).toBe(409);
      expect(rooms.notifications).toEqual([]);
    });

    it("sends nothing for a join that lost a race", async () => {
      const { storyId } = await twoPersonStory();
      const rooms = fakeRooms();
      const env = { ...rooms.env, DB: gateLoads(testEnv.env.DB, 2) };
      const joiners = [nameInTest("Carol"), nameInTest("Dee")].map((displayName) => ({
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
      await joinStory(carol, storyId, nameInTest("Carol"));
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
        `/api/stories/${storyId}/passages`,
        { text: "Still saved.", turnVersion: version, startsParagraph: false },
        { env: rooms.env },
      );
      await Promise.all(ben.backgroundWork);

      expect(response.status).toBe(201);
      expect(log).toHaveBeenCalledWith("StoryRoom notify failed", expect.any(Error));
      expect((await readStory(ben, storyId)).passages.map((c) => c.text)).toContain("Still saved.");
      log.mockRestore();
    });

    it("still answers the write when the room rejects, and logs it", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms(() => Promise.reject(new Error("room unreachable")));
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const version = (await readStory(ben, storyId)).turn.version;

      const response = await ben.post(
        `/api/stories/${storyId}/passages`,
        { text: "Still saved.", turnVersion: version, startsParagraph: false },
        { env: rooms.env },
      );
      await Promise.all(ben.backgroundWork);

      expect(response.status).toBe(201);
      expect(log).toHaveBeenCalledWith("StoryRoom notify failed", expect.any(Error));
      log.mockRestore();
    });

    it("answers the write without waiting for a room that never answers", async () => {
      const { ben, storyId } = await twoPersonStory();
      const rooms = fakeRooms(() => new Promise(() => undefined));
      const version = (await readStory(ben, storyId)).turn.version;

      const response = await ben.post(
        `/api/stories/${storyId}/passages`,
        { text: "Saved anyway.", turnVersion: version, startsParagraph: false },
        { env: rooms.env },
      );

      expect(response.status).toBe(201);
      expect(rooms.notifications).toHaveLength(1);
      // The notification is handed to waitUntil and still pending; the write is committed.
      const notification = ben.backgroundWork.at(-1);
      expect(await Promise.race([notification, Promise.resolve("still pending")])).toBe(
        "still pending",
      );
      expect((await readStory(ben, storyId)).passages.map((c) => c.text)).toContain(
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
