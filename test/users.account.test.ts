import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { myStoriesResponseSchema } from "../src/shared/api";
import { loadPushSubscriptions } from "../src/worker/db/pushRepo";
import { findUserByClerkUserId } from "../src/worker/db/userRepo";
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
import { createFakePushSender, type FakePushSender } from "./support/fakePushSender";
import { signSessionToken, type SessionTokenOptions } from "./support/sessionToken";
import { createTestEnv, type TestEnv } from "./support/testEnv";
import { userIdOf } from "./support/users";

const ORIGIN = "http://localhost";
const PATH = "/api/users/me/account";
const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);

const rowSchema = z.object({
  userId: z.string(),
  leftAt: z.number().nullable(),
  position: z.number(),
});

describe("PUT /api/users/me/account", () => {
  let testEnv: TestEnv;
  let env: Env;
  let sender: FakePushSender;
  let storyCount = 0;
  const clock: Clock = { now: T0 };
  let app: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    testEnv = await createTestEnv();
    env = withQuietRoom(testEnv.env);
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  // A fresh sender per test; story IDs stay unique across the file.
  function setUp(): void {
    sender = createFakePushSender();
    app = createTestApp(
      clock,
      () => {
        storyCount += 1;
        return `u${String(storyCount).padStart(4, "0")}`;
      },
      undefined,
      undefined,
      sender,
    );
  }

  // A browser that holds a cookie and no session.
  const anonymous = () => createBrowser(app, env, ORIGIN);

  async function account(clerkUserId: string, options?: SessionTokenOptions): Promise<Browser> {
    const browser = createBrowser(app, env, ORIGIN);
    browser.sessionToken = await signSessionToken(clerkUserId, ORIGIN, options);

    return browser;
  }

  async function participantRows(storyId: string) {
    const result = await testEnv.env.DB.prepare(
      `SELECT user_id AS userId, left_at AS leftAt, position FROM participants
       WHERE story_id = ? ORDER BY position`,
    )
      .bind(storyId)
      .all();

    return z.array(rowSchema).parse(result.results);
  }

  async function count(table: "users" | "participants" | "push_subscriptions"): Promise<number> {
    const row = await testEnv.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();

    return z.object({ count: z.number() }).parse(row).count;
  }

  describe("a first sign-in", () => {
    it("gives the device user the account, keeps its stories and answers 204", async () => {
      setUp();
      const phone = anonymous();
      const storyId = await createStory(phone);
      const deviceUserId = await userIdOf(testEnv.env.DB, phone);

      const response = await signIn(phone, "user_first");

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect((await findUserByClerkUserId(testEnv.env.DB, "user_first"))?.id).toBe(deviceUserId);
      expect(await storyIds(phone)).toEqual([storyId]);
      const hash = await testEnv.env.DB.prepare(
        "SELECT browser_token_hash AS hash FROM users WHERE id = ?",
      )
        .bind(deviceUserId)
        .first();
      expect(z.object({ hash: z.null() }).parse(hash)).toEqual({ hash: null });
    });

    it("does nothing for a browser with no user", async () => {
      setUp();
      const before = await count("users");

      const response = await signIn(anonymous(), "user_nobody");

      expect(response.status).toBe(204);
      expect(await count("users")).toBe(before);
    });

    it("leaves the cookie naming no user, so signing out forgets the stories", async () => {
      setUp();
      const phone = anonymous();
      await createStory(phone);
      await signIn(phone, "user_signs_out");

      phone.sessionToken = null;

      expect(await storyIds(phone)).toEqual([]);
    });

    it("lets the next sign-in find the stories again", async () => {
      setUp();
      const phone = anonymous();
      const storyId = await createStory(phone);
      await signIn(phone, "user_back");

      phone.sessionToken = await signSessionToken("user_back", ORIGIN);

      expect(await storyIds(phone)).toEqual([storyId]);
    });
  });

  describe("a second device", () => {
    it("moves the device's stories and push subscriptions to the account user", async () => {
      setUp();
      const laptop = await account("user_merge");
      const laptopStory = await createStory(laptop, "Ana");
      const phone = anonymous();
      const phoneStory = await createStory(phone, "Ana on phone");
      const endpoint = await subscribe(phone, "phone-merge");
      const deviceUserId = await userIdOf(testEnv.env.DB, phone);

      const response = await signIn(phone, "user_merge");

      expect(response.status).toBe(204);
      expect(await storyIds(phone)).toEqual([laptopStory, phoneStory].toSorted());
      expect(await storyIds(laptop)).toEqual([laptopStory, phoneStory].toSorted());
      const accountUser = await findUserByClerkUserId(testEnv.env.DB, "user_merge");
      expect(await loadPushSubscriptions(testEnv.env.DB, accountUser?.id ?? "")).toEqual([
        { endpoint, p256dh: P256DH, auth: AUTH },
      ]);
      const stillThere = await testEnv.env.DB.prepare("SELECT id FROM users WHERE id = ?")
        .bind(deviceUserId)
        .first();
      expect(stillThere).toBeNull();
    });

    it("is safe to repeat", async () => {
      setUp();
      const laptop = await account("user_repeat");
      await createStory(laptop);
      const phone = anonymous();
      await createStory(phone, "Ana on phone");
      await signIn(phone, "user_repeat");
      const before = [await count("users"), await count("participants")];

      const again = await phone.put(PATH, {});
      const laptopAgain = await laptop.put(PATH, {});

      expect([again.status, laptopAgain.status]).toEqual([204, 204]);
      expect([await count("users"), await count("participants")]).toEqual(before);
      expect(await storyIds(phone)).toHaveLength(2);
    });

    it("takes the device out of a story both are in: the turn passes and the row is the account's", async () => {
      setUp();
      const laptop = await account("user_shared");
      const storyId = await createStory(laptop, "Ana");
      const phone = anonymous();
      await joinStory(phone, storyId, "Ana on phone");
      const ben = anonymous();
      await joinStory(ben, storyId, "Ben");
      await subscribe(ben, "ben-shared");
      await settle(laptop, phone, ben);
      const accountUser = await findUserByClerkUserId(testEnv.env.DB, "user_shared");
      expect(accountUser).not.toBeNull();
      // Ana wrote the opening, so the phone holds the turn.
      const before = await readStory(phone, storyId);
      expect(before.turn.holderId).toBe(before.me);
      sender.sent.length = 0;

      const response = await signIn(phone, "user_shared");
      await settle(phone);

      expect(response.status).toBe(204);
      const rows = await participantRows(storyId);
      expect(rows.map((row) => row.userId)).toEqual([
        accountUser?.id,
        accountUser?.id,
        expect.any(String),
      ]);
      expect(rows.map((row) => row.leftAt !== null)).toEqual([false, true, false]);
      const asBen = await readStory(ben, storyId);
      expect(asBen.turn.holderId).toBe(asBen.me);
      expect(sender.sent.map(({ subscription }) => subscription.endpoint)).toEqual([
        "https://fcm.googleapis.com/send/ben-shared",
      ]);
      expect(await storyIds(laptop)).toEqual([storyId]);
    });

    it("answers 409 stale_turn when other writes keep moving the story, and a retry finishes", async () => {
      setUp();
      const laptop = await account("user_stale");
      const storyId = await createStory(laptop, "Ana");
      const phone = anonymous();
      await joinStory(phone, storyId, "Ana on phone");
      await joinStory(anonymous(), storyId, "Ben");
      const outpaced = outpacedLeaves(env, storyId);
      phone.sessionToken = await signSessionToken("user_stale", ORIGIN);

      const refused = await phone.put(PATH, {}, { env: outpaced });

      expect(refused.status).toBe(409);
      expect(await readError(refused)).toBe("stale_turn");
      expect((await participantRows(storyId)).map((row) => row.leftAt !== null)).toEqual([
        false,
        false,
        false,
      ]);
      const retried = await phone.put(PATH, {});
      expect(retried.status).toBe(204);
      expect((await participantRows(storyId)).map((row) => row.leftAt !== null)).toEqual([
        false,
        true,
        false,
      ]);
    });
  });

  describe("the user's devices", () => {
    it("lists the stories of both and pushes the turn to both", async () => {
      setUp();
      const laptop = await account("user_devices");
      const storyId = await createStory(laptop, "Ana");
      const laptopEndpoint = await subscribe(laptop, "laptop-devices");
      const ben = anonymous();
      await joinStory(ben, storyId, "Ben");
      const phone = anonymous();
      const phoneStory = await createStory(phone, "Ana on phone");
      const phoneEndpoint = await subscribe(phone, "phone-devices");
      await signIn(phone, "user_devices");
      await settle(laptop, phone, ben);
      sender.sent.length = 0;
      const view = await readStory(ben, storyId);

      const written = await ben.post(`/api/stories/${storyId}/contributions`, {
        text: "And then.",
        turnVersion: view.turn.version,
        startsParagraph: false,
      });
      await settle(ben);

      expect(written.status).toBe(204);
      expect(await storyIds(laptop)).toEqual([storyId, phoneStory].toSorted());
      expect(await storyIds(phone)).toEqual([storyId, phoneStory].toSorted());
      expect(sender.sent.map(({ subscription }) => subscription.endpoint).toSorted()).toEqual(
        [laptopEndpoint, phoneEndpoint].toSorted(),
      );
    });
  });

  describe("a request that is not signed in", () => {
    const cases: [string, () => Promise<Browser>][] = [
      ["expired", () => account("user_x", { expiresInSeconds: -120 })],
      ["signed by another key", () => account("user_x", { signWithOtherKey: true })],
      [
        "issued for another origin",
        async () => {
          const browser = createBrowser(app, env, ORIGIN);
          browser.sessionToken = await signSessionToken("user_x", "https://evil.example");

          return browser;
        },
      ],
      ["missing", () => Promise.resolve(anonymous())],
    ];

    it.each(cases)(
      "is refused with 401 and a challenge when the token is %s",
      async (_name, make) => {
        setUp();
        const browser = await make();
        await createStory(createBrowser(app, env, ORIGIN));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const before = [await count("users"), await count("participants")];

        const response = await browser.put(PATH, {});

        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toBe('Bearer error="invalid_token"');
        expect(await readError(response)).toBe("invalid_session_token");
        expect([await count("users"), await count("participants")]).toEqual(before);
        warn.mockRestore();
      },
    );

    it("is refused from another origin before the token is read", async () => {
      setUp();
      const browser = await account("user_origin");

      const response = await browser.put(PATH, {}, { origin: "https://evil.example" });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("forbidden_origin");
    });

    it("refuses a body with fields", async () => {
      setUp();
      const browser = await account("user_body");

      const response = await browser.put(PATH, { clerkUserId: "user_other" });

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
    });
  });
});

// Another write moves the story's turn version after every batch, so a leave never finds the
// version it loaded.
function outpacedLeaves(base: Env, storyId: string): Env {
  const db = base.DB;
  const outpaced = {
    prepare: (query: string) => db.prepare(query),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const results = await db.batch<T>(statements);
      await db
        .prepare("UPDATE stories SET turn_version = turn_version + 1 WHERE id = ?")
        .bind(storyId)
        .run();

      return results;
    },
  };

  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, { DB: outpaced });
}

// The test bed's STORY_ROOM can't reach the Durable Object, so every write would log a failed
// room notification. This room accepts and ignores them.
function withQuietRoom(base: Env): Env {
  const quietRoom = { getByName: () => ({ notify: () => Promise.resolve() }) };

  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, { STORY_ROOM: quietRoom });
}

async function signIn(browser: Browser, clerkUserId: string): Promise<Response> {
  browser.sessionToken = await signSessionToken(clerkUserId, ORIGIN);

  return browser.put(PATH, {});
}

async function storyIds(browser: Browser): Promise<string[]> {
  const response = await browser.get("/api/stories");
  expect(response.status).toBe(200);

  return myStoriesResponseSchema
    .parse(await response.json())
    .stories.map((story) => story.id)
    .toSorted();
}

async function subscribe(browser: Browser, name: string): Promise<string> {
  const endpoint = `https://fcm.googleapis.com/send/${name}`;
  const response = await browser.put("/api/push-subscription", {
    endpoint,
    keys: { p256dh: P256DH, auth: AUTH },
  });
  expect(response.status).toBe(204);

  return endpoint;
}

async function settle(...browsers: Browser[]): Promise<void> {
  await Promise.all(browsers.flatMap((browser) => browser.backgroundWork.splice(0)));
}
