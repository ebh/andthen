import { createTestHarness, type TestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createStoryResponseSchema,
  liveMessageSchema,
  storyViewSchema,
  type StoryView,
} from "../src/shared/api";

// The workerd-side socket the harness hands back, which isn't the DOM WebSocket type.
type Socket = NonNullable<Awaited<ReturnType<TestHarness["fetch"]>>["webSocket"]>;

// Runs the real Worker (src/worker/index.ts, StoryRoom included) in workerd, because Node can't
// load `cloudflare:workers`. Stryker doesn't mutate storyRoom.ts and index.ts, so this is their
// only coverage.
describe("StoryRoom in workerd", () => {
  const server = createTestHarness({
    // wrangler.jsonc minus `assets`, which needs a built `dist/` this test has no use for.
    workers: [
      {
        config: {
          name: "andthen-test",
          main: "src/worker/index.ts",
          compatibility_date: "2026-10-23",
          d1_databases: [
            { binding: "DB", database_name: "andthen-test", migrations_dir: "migrations" },
          ],
          durable_objects: { bindings: [{ name: "STORY_ROOM", class_name: "StoryRoom" }] },
          migrations: [{ tag: "v1", new_sqlite_classes: ["StoryRoom"] }],
          vars: { AI_PROVIDER: "fake" },
        },
      },
    ],
  });
  // The harness serves on a random port, and the same-origin check compares against it.
  let origin = "";
  const openSockets: Socket[] = [];

  beforeAll(async () => {
    const { url } = await server.listen();
    origin = url.origin;
    await server.getWorker().applyD1Migrations("DB");
  }, 60_000);

  afterAll(async () => {
    for (const socket of openSockets) {
      socket.close();
    }
    await server.close();
  });

  describe("upgrade guard", () => {
    it("refuses every upgrade that isn't a participant's same-origin one", async () => {
      const { storyId, cookie } = await createStory("Ana");
      const attempts: Record<string, string>[] = [
        { Origin: origin },
        { Origin: origin, Cookie: "andthen_bt=not-a-participant" },
        { Origin: "https://evil.example", Cookie: cookie },
        { Cookie: cookie },
      ];

      for (const headers of attempts) {
        const response = await server.fetch(`/api/stories/${storyId}/live`, {
          headers: { Upgrade: "websocket", ...headers },
        });

        expect(response.status).toBe(403);
      }
    });

    it("answers 404 for an unknown story", async () => {
      const { cookie } = await createStory("Ana");

      const response = await server.fetch("/api/stories/zzzzz/live", {
        headers: { Upgrade: "websocket", Origin: origin, Cookie: cookie },
      });

      expect(response.status).toBe(404);
    });

    it("accepts a participant's same-origin upgrade", async () => {
      const { storyId, cookie } = await createStory("Ana");

      const socket = await openSocket(storyId, cookie);

      expect(socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  describe("broadcast", () => {
    it("reaches a participant's socket after another participant writes", async () => {
      const ana = await createStory("Ana");
      const ben = await join(ana.storyId, "Ben");
      const socket = await openSocket(ana.storyId, ana.cookie);
      const heard = nextMessage(socket);
      const { turn } = await readStory(ana.storyId, ben.cookie);

      const written = await post(
        `/api/stories/${ana.storyId}/contributions`,
        { text: "And then.", turnVersion: turn.version },
        ben.cookie,
      );

      expect(written.status).toBe(204);
      const message = liveMessageSchema.parse(JSON.parse(await heard));
      expect(message.version).toBe(turn.version + 1);
    });

    it("reaches every socket of the story and none of another story", async () => {
      const ana = await createStory("Ana");
      const other = await createStory("Zed");
      const ben = await join(ana.storyId, "Ben");
      // With two people the turn can't be skipped: it would come straight back to the holder.
      await join(ana.storyId, "Carol");
      const anaSocket = await openSocket(ana.storyId, ana.cookie);
      const benSocket = await openSocket(ana.storyId, ben.cookie);
      const otherSocket = await openSocket(other.storyId, other.cookie);
      const heard = [nextMessage(anaSocket), nextMessage(benSocket)];
      const overheard: string[] = [];
      otherSocket.addEventListener("message", (event) => overheard.push(messageText(event.data)));
      const { turn } = await readStory(ana.storyId, ana.cookie);

      const skipped = await post(
        `/api/stories/${ana.storyId}/skip`,
        { turnVersion: turn.version },
        ana.cookie,
      );
      expect(skipped.status).toBe(204);

      expect(await Promise.all(heard)).toHaveLength(2);
      // Time for a wrong delivery to arrive.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(overheard).toEqual([]);
    });

    it("answers a write nobody is listening to", async () => {
      const ana = await createStory("Ana");
      const ben = await join(ana.storyId, "Ben");
      const { turn } = await readStory(ana.storyId, ben.cookie);

      const written = await post(
        `/api/stories/${ana.storyId}/contributions`,
        { text: "Nobody listening.", turnVersion: turn.version },
        ben.cookie,
      );

      expect(written.status).toBe(204);
    });
  });

  async function createStory(displayName: string): Promise<{ storyId: string; cookie: string }> {
    const response = await post("/api/stories", { displayName, opening: "Once upon a time." });
    expect(response.status).toBe(201);
    const { storyId } = createStoryResponseSchema.parse(await response.json());

    return { storyId, cookie: cookieFrom(response.headers.getSetCookie()) };
  }

  async function join(storyId: string, displayName: string): Promise<{ cookie: string }> {
    const response = await post(`/api/stories/${storyId}/participants`, { displayName });
    expect(response.status).toBe(201);

    return { cookie: cookieFrom(response.headers.getSetCookie()) };
  }

  async function readStory(storyId: string, cookie: string): Promise<StoryView> {
    const response = await server.fetch(`/api/stories/${storyId}`, { headers: { Cookie: cookie } });

    return storyViewSchema.parse(await response.json());
  }

  function post(pathname: string, body: unknown, cookie?: string) {
    return server.fetch(pathname, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(cookie === undefined ? {} : { Cookie: cookie }),
      },
      body: JSON.stringify(body),
    });
  }

  async function openSocket(storyId: string, cookie: string): Promise<Socket> {
    const response = await server.fetch(`/api/stories/${storyId}/live`, {
      headers: { Upgrade: "websocket", Origin: origin, Cookie: cookie },
    });
    const socket = response.webSocket;
    if (response.status !== 101 || socket === null) {
      throw new Error(`Upgrade refused with ${String(response.status)}`);
    }
    socket.accept();
    openSockets.push(socket);

    return socket;
  }
});

// `name=value` of the first Set-Cookie, ready to send back as a Cookie header.
function cookieFrom(setCookies: string[]): string {
  const [pair = ""] = (setCookies[0] ?? "").split(";");

  return pair;
}

function nextMessage(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => {
      resolve(messageText(event.data));
    });
  });
}

function messageText(data: unknown): string {
  if (typeof data !== "string") {
    throw new Error("Expected a text message");
  }

  return data;
}
