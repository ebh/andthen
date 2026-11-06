import { readFile } from "node:fs/promises";
import path from "node:path";

import { createTestHarness, type TestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createStoryResponseSchema,
  errorBodySchema,
  liveMessageSchema,
  storyViewSchema,
  type StoryView,
} from "../src/shared/api";
import { TURN_WINDOW_MS } from "../src/shared/validation";

// The workerd-side socket the harness hands back, which isn't the DOM WebSocket type.
type Socket = NonNullable<Awaited<ReturnType<TestHarness["fetch"]>>["webSocket"]>;

// Runs the real Worker (src/worker/index.ts, StoryRoom included) in workerd, because Node can't
// load `cloudflare:workers`. Stryker doesn't mutate storyRoom.ts and index.ts, so this is their
// only coverage.
describe("StoryRoom in workerd", () => {
  // Configured in beforeAll, from wrangler.jsonc.
  const server = createTestHarness();
  // The harness serves on a random port, and the same-origin check compares against it.
  let origin = "";
  const openSockets: Socket[] = [];

  beforeAll(async () => {
    await server.update({ workers: [{ config: await readWranglerConfig() }] });
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
    it("refuses every upgrade that isn't a participant's same-origin one, and says why", async () => {
      const { storyId, cookie } = await createStory("Ana");
      const attempts: [Record<string, string>, string][] = [
        [{ Origin: origin }, "not_participant"],
        [{ Origin: origin, Cookie: "andthen_bt=not-a-participant" }, "not_participant"],
        [{ Origin: "https://evil.example", Cookie: cookie }, "forbidden_origin"],
        [{ Cookie: cookie }, "forbidden_origin"],
      ];

      for (const [headers, reason] of attempts) {
        const response = await server.fetch(`/api/stories/${storyId}/live`, {
          headers: { Upgrade: "websocket", ...headers },
        });

        expect(response.status).toBe(403);
        expect(errorBodySchema.parse(await response.json()).error).toBe(reason);
      }
    });

    it("answers 404 for an unknown story", async () => {
      const { cookie } = await createStory("Ana");

      const response = await server.fetch("/api/stories/zzzzz/live", {
        headers: { Upgrade: "websocket", Origin: origin, Cookie: cookie },
      });

      expect(response.status).toBe(404);
      expect(errorBodySchema.parse(await response.json()).error).toBe("not_found");
    });

    it("accepts a participant's same-origin upgrade", async () => {
      const { storyId, cookie } = await createStory("Ana");

      const socket = await openSocket(storyId, cookie);

      expect(socket.readyState).toBe(WebSocket.OPEN);
    });
  });

  describe("heartbeat", () => {
    it("answers the client's ping with pong", async () => {
      const { storyId, cookie } = await createStory("Ana");
      const socket = await openSocket(storyId, cookie);
      const heard = nextMessage(socket);

      socket.send("ping");

      expect(await heard).toBe("pong");
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
        { text: "And then.", turnVersion: turn.version, startsParagraph: false },
        ben.cookie,
      );

      expect(written.status).toBe(204);
      const message = liveMessageSchema.parse(JSON.parse(await heard));
      expect(message.version).toBe(turn.version + 1);
    });

    it("reaches every socket of the story and none of another story", async () => {
      const ana = await createStory("Ana");
      const ben = await join(ana.storyId, "Ben");
      // With two people the turn can't be skipped: it would come straight back to the holder.
      await join(ana.storyId, "Carol");
      const zed = await createStory("Zed");
      const yan = await join(zed.storyId, "Yan");
      const anaSocket = await openSocket(ana.storyId, ana.cookie);
      const benSocket = await openSocket(ana.storyId, ben.cookie);
      const zedSocket = await openSocket(zed.storyId, zed.cookie);
      const zedHeard: string[] = [];
      zedSocket.addEventListener("message", (event) => zedHeard.push(messageText(event.data)));
      const heardInAnasStory = [nextMessage(anaSocket), nextMessage(benSocket)];
      const { turn: anasTurn } = await readStory(ana.storyId, ana.cookie);

      const skipped = await post(
        `/api/stories/${ana.storyId}/skip`,
        { turnVersion: anasTurn.version },
        ana.cookie,
      );
      expect(skipped.status).toBe(204);
      await Promise.all(heardInAnasStory);

      // Zed's story then changes, so the one message Zed's socket gets is its own, and anything
      // sent to it earlier by mistake would have to be in the list before it.
      const heardSentinel = nextMessage(zedSocket);
      const { turn: zedsTurn } = await readStory(zed.storyId, yan.cookie);
      const written = await post(
        `/api/stories/${zed.storyId}/contributions`,
        { text: "Zed's story moves on.", turnVersion: zedsTurn.version, startsParagraph: false },
        yan.cookie,
      );
      expect(written.status).toBe(204);

      const sentinel = await heardSentinel;
      expect(zedHeard).toEqual([sentinel]);
      expect(liveMessageSchema.parse(JSON.parse(sentinel)).version).toBe(zedsTurn.version + 1);
    });

    it("answers a write nobody is listening to", async () => {
      const ana = await createStory("Ana");
      const ben = await join(ana.storyId, "Ben");
      const { turn } = await readStory(ana.storyId, ben.cookie);

      const written = await post(
        `/api/stories/${ana.storyId}/contributions`,
        { text: "Nobody listening.", turnVersion: turn.version, startsParagraph: false },
        ben.cookie,
      );

      expect(written.status).toBe(204);
    });
  });

  describe("turn timeout alarm", () => {
    it("saves the lapsed turn and tells open sockets when the alarm fires", async () => {
      const ana = await createStory("Ana");
      await join(ana.storyId, "Ben");
      await join(ana.storyId, "Cy");
      const env = await server.getWorker<Env>().getEnv();
      const { turnVersion } = await readTurn(env.DB, ana.storyId);
      // Ben's window ended a second ago. Nothing is saved until the room's alarm fires.
      await env.DB.prepare("UPDATE stories SET turn_started_at = ? WHERE id = ?")
        .bind(Date.now() - TURN_WINDOW_MS - 1000, ana.storyId)
        .run();
      const socket = await openSocket(ana.storyId, ana.cookie);
      // The notify itself is announced first, at the version it carries; the alarm's is the next.
      const heard = nextMessages(socket, 2);

      await env.STORY_ROOM.getByName(ana.storyId).notify(
        { version: turnVersion },
        { storyId: ana.storyId, origin, deadline: Date.now() + 50 },
      );

      const versions = (await heard).map(
        (text) => liveMessageSchema.parse(JSON.parse(text)).version,
      );
      expect(versions).toEqual([turnVersion, turnVersion + 1]);
      expect((await readTurn(env.DB, ana.storyId)).turnVersion).toBe(turnVersion + 1);
    }, 15_000);

    it("does not fire after a notification without a deadline", async () => {
      const ana = await createStory("Ana");
      await join(ana.storyId, "Ben");
      await join(ana.storyId, "Cy");
      const env = await server.getWorker<Env>().getEnv();
      const { turnVersion } = await readTurn(env.DB, ana.storyId);
      await env.DB.prepare("UPDATE stories SET turn_started_at = ? WHERE id = ?")
        .bind(Date.now() - TURN_WINDOW_MS - 1000, ana.storyId)
        .run();
      const room = env.STORY_ROOM.getByName(ana.storyId);
      await room.notify(
        { version: turnVersion },
        { storyId: ana.storyId, origin, deadline: Date.now() + 50 },
      );

      await room.notify({ version: turnVersion }, { storyId: ana.storyId, origin, deadline: null });
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect((await readTurn(env.DB, ana.storyId)).turnVersion).toBe(turnVersion);
    }, 15_000);
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

async function readTurn(db: D1Database, storyId: string): Promise<{ turnVersion: number }> {
  const row = await db
    .prepare("SELECT turn_version AS turnVersion FROM stories WHERE id = ?")
    .bind(storyId)
    .first();

  return z.object({ turnVersion: z.number() }).parse(row);
}

function nextMessages(socket: Socket, count: number): Promise<string[]> {
  return new Promise((resolve) => {
    const heard: string[] = [];
    socket.addEventListener("message", (event) => {
      heard.push(messageText(event.data));
      if (heard.length === count) {
        resolve(heard);
      }
    });
  });
}

function messageText(data: unknown): string {
  if (typeof data !== "string") {
    throw new Error("Expected a text message");
  }

  return data;
}

const wranglerConfigSchema = z.object({
  name: z.string(),
  main: z.string(),
  compatibility_date: z.string(),
  d1_databases: z.array(
    z.object({
      binding: z.string(),
      database_name: z.string(),
      database_id: z.string(),
      migrations_dir: z.string(),
    }),
  ),
  durable_objects: z.object({
    bindings: z.array(z.object({ name: z.string(), class_name: z.string() })),
  }),
  migrations: z.array(z.object({ tag: z.string(), new_sqlite_classes: z.array(z.string()) })),
  vars: z.record(z.string(), z.string()),
});

// The top-level (local dev) config without `assets`, which needs a built `dist/` this test has
// no use for. Fields the schema doesn't name, `assets` among them, are dropped.
async function readWranglerConfig(): Promise<z.infer<typeof wranglerConfigSchema>> {
  const text = await readFile(path.join(import.meta.dirname, "../wrangler.jsonc"), "utf8");

  return wranglerConfigSchema.parse(parseJsonc(text));
}

// Handles only what wrangler.jsonc uses: comments on lines of their own, and trailing commas.
function parseJsonc(text: string): unknown {
  const withoutComments = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, "$1"));
}
