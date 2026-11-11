import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { canSkipTurn } from "../src/client/storyRules";
import {
  createLegalDocumentAcceptanceResponseSchema,
  meResponseSchema,
  myStoriesResponseSchema,
} from "../src/shared/api";
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
  nameInTest,
} from "./support/browser";
import { deletePushSubscription, putPushSubscription } from "./support/pushSubscriptions";
import { createFakePushSender, type FakePushSender } from "./support/fakePushSender";
import { signSessionToken, type SessionTokenOptions } from "./support/sessionToken";
import { createTestEnv, type TestEnv } from "./support/testEnv";
import { userIdOf } from "./support/users";

const ORIGIN = "http://localhost";
const PATH = "/api/users/me/account";
const ACCEPTANCES_PATH = "/api/users/me/legal-document-acceptances";
const TERMS_OF_SERVICE_V1 = { legalDocumentId: "terms-of-service", version: 1 };
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

  async function acceptanceRows() {
    const result = await testEnv.env.DB.prepare(
      `SELECT id, user_id AS userId, legal_document_id AS legalDocumentId, version,
         story_id AS storyId, accepted_at AS acceptedAt
       FROM legal_document_acceptances ORDER BY id`,
    ).all();

    return z
      .array(
        z.object({
          id: z.string(),
          userId: z.string(),
          legalDocumentId: z.string(),
          version: z.number(),
          storyId: z.string().nullable(),
          acceptedAt: z.number(),
        }),
      )
      .parse(result.results);
  }

  async function pushEndpoints(): Promise<string[]> {
    const result = await testEnv.env.DB.prepare("SELECT endpoint FROM push_subscriptions").all();

    return z
      .array(z.object({ endpoint: z.string() }))
      .parse(result.results)
      .map((row) => row.endpoint);
  }

  async function count(table: "users" | "participants" | "push_subscriptions"): Promise<number> {
    const row = await testEnv.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();

    return z.object({ count: z.number() }).parse(row).count;
  }

  describe("GET /api/users/me", () => {
    it("reports no name and creates no user or cookie for a browser with none, then the name once it has one", async () => {
      setUp();
      const phone = anonymous();
      const signedIn = await account("user_me_unknown");
      const users = await count("users");

      const before = await phone.get("/api/users/me");
      const signedInBefore = await signedIn.get("/api/users/me");

      expect(meResponseSchema.parse(await before.json())).toEqual({
        displayName: null,
        missingLegalDocumentAcceptances: [TERMS_OF_SERVICE_V1],
      });
      expect(meResponseSchema.parse(await signedInBefore.json())).toEqual({
        displayName: null,
        missingLegalDocumentAcceptances: [TERMS_OF_SERVICE_V1],
      });
      expect([before.headers.getSetCookie(), signedInBefore.headers.getSetCookie()]).toEqual([
        [],
        [],
      ]);
      expect(await count("users")).toBe(users);
      expect(await findUserByClerkUserId(testEnv.env.DB, "user_me_unknown")).toBeNull();

      await createStory(phone, nameInTest("Ana on phone"));
      const after = await phone.get("/api/users/me");

      expect(meResponseSchema.parse(await after.json())).toEqual({
        displayName: nameInTest("Ana on phone"),
        missingLegalDocumentAcceptances: [TERMS_OF_SERVICE_V1],
      });
    });
  });

  describe("POST /api/users/me/legal-document-acceptances", () => {
    it("records the legal document acceptance for a new browser and stops listing it as missing", async () => {
      setUp();
      const phone = anonymous();

      const response = await phone.post(ACCEPTANCES_PATH, TERMS_OF_SERVICE_V1);

      expect(response.status).toBe(201);
      const { legalDocumentAcceptanceId } = createLegalDocumentAcceptanceResponseSchema.parse(
        await response.json(),
      );
      expect(response.headers.get("Location")).toBe(
        `${ACCEPTANCES_PATH}/${legalDocumentAcceptanceId}`,
      );
      expect(response.headers.getSetCookie()).toHaveLength(1);
      expect(await acceptanceRows()).toEqual([
        {
          id: legalDocumentAcceptanceId,
          userId: await userIdOf(testEnv.env.DB, phone),
          legalDocumentId: "terms-of-service",
          version: 1,
          storyId: null,
          acceptedAt: clock.now,
        },
      ]);
      const me = meResponseSchema.parse(await (await phone.get("/api/users/me")).json());
      expect(me.missingLegalDocumentAcceptances).toEqual([]);
    });

    it("records it for the account user of a signed-in request", async () => {
      setUp();
      const laptop = await account("user_accepts_terms");

      const response = await laptop.post(ACCEPTANCES_PATH, TERMS_OF_SERVICE_V1);

      expect(response.status).toBe(201);
      const accountUser = await findUserByClerkUserId(testEnv.env.DB, "user_accepts_terms");
      expect((await acceptanceRows()).map(({ userId }) => userId)).toContain(accountUser?.id);
    });

    it("refuses a version that is not the current one, or a field it does not know, and creates no user", async () => {
      setUp();
      const phone = anonymous();
      const users = await count("users");
      const acceptances = (await acceptanceRows()).length;

      const stale = await phone.post(ACCEPTANCES_PATH, { ...TERMS_OF_SERVICE_V1, version: 2 });
      const extra = await phone.post(ACCEPTANCES_PATH, {
        ...TERMS_OF_SERVICE_V1,
        storyId: "abc12",
      });

      expect([await readError(stale), await readError(extra)]).toEqual([
        "bad_request",
        "bad_request",
      ]);
      expect([stale.status, extra.status]).toEqual([400, 400]);
      expect(await count("users")).toBe(users);
      expect(await acceptanceRows()).toHaveLength(acceptances);
    });
  });

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

    it("changes nothing for a user that already holds the account and still has its cookie", async () => {
      setUp();
      const phone = anonymous();
      const storyId = await createStory(phone);
      const userId = await userIdOf(testEnv.env.DB, phone);
      await testEnv.env.DB.prepare("UPDATE users SET clerk_user_id = ? WHERE id = ?")
        .bind("user_both", userId)
        .run();

      const response = await signIn(phone, "user_both");

      expect(response.status).toBe(204);
      expect(await userIdOf(testEnv.env.DB, phone)).toBe(userId);
      expect(await storyIds(phone)).toEqual([storyId]);
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
      const laptopStory = await createStory(laptop, nameInTest("Ana"));
      const phone = anonymous();
      const phoneStory = await createStory(phone, nameInTest("Ana on phone"));
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
      // The passages move with the user, and the account user's name wins over the device's.
      const phoneView = await readStory(laptop, phoneStory);
      expect(phoneView.passages.map(({ authorId, authorName }) => [authorId, authorName])).toEqual([
        [accountUser?.id, nameInTest("Ana")],
      ]);
      expect(phoneView.participants.map(({ userId }) => userId)).toEqual([accountUser?.id]);
      await createStory(anonymous(), nameInTest("Ana on phone"));
    });

    it("carries the device user's legal document acceptances to the account user, so the account is not asked again", async () => {
      setUp();
      const laptop = await account("user_merge_terms");
      await createStory(laptop, nameInTest("Ana"));
      const phone = anonymous();
      await phone.post(ACCEPTANCES_PATH, TERMS_OF_SERVICE_V1);
      const deviceUserId = await userIdOf(testEnv.env.DB, phone);

      const response = await signIn(phone, "user_merge_terms");

      expect(response.status).toBe(204);
      const accountUser = await findUserByClerkUserId(testEnv.env.DB, "user_merge_terms");
      const rows = await acceptanceRows();
      expect(rows.filter(({ userId }) => userId === accountUser?.id)).toHaveLength(1);
      expect(rows.some(({ userId }) => userId === deviceUserId)).toBe(false);
      const me = meResponseSchema.parse(await (await laptop.get("/api/users/me")).json());
      expect(me.missingLegalDocumentAcceptances).toEqual([]);
    });

    it("merges when another request claims the account while this one attaches it", async () => {
      setUp();
      const phone = anonymous();
      const phoneStory = await createStory(phone, nameInTest("Ana on phone"));
      const deviceUserId = await userIdOf(testEnv.env.DB, phone);
      phone.sessionToken = await signSessionToken("user_raced", ORIGIN);

      const response = await phone.put(
        PATH,
        {},
        { env: claimedJustBeforeAttach(env, "user_raced") },
      );

      expect(response.status).toBe(204);
      const accountUser = await findUserByClerkUserId(testEnv.env.DB, "user_raced");
      expect(accountUser?.id).not.toBe(deviceUserId);
      expect((await participantRows(phoneStory)).map((row) => row.userId)).toEqual([
        accountUser?.id,
      ]);
    });

    it("is safe to repeat", async () => {
      setUp();
      const laptop = await account("user_repeat");
      await createStory(laptop);
      const phone = anonymous();
      await createStory(phone, nameInTest("Ana on phone"));
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
      const storyId = await createStory(laptop, nameInTest("Ana"));
      const phone = anonymous();
      await joinStory(phone, storyId, nameInTest("Ana on phone"));
      const ben = anonymous();
      await joinStory(ben, storyId, nameInTest("Ben"));
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

    // The device wrote last, then left the story in the merge, so its passage is now the account
    // user's. Without moving the last contributor to the account user's active row, a skip of Ben
    // would hand the turn to the account user right after they wrote, while the client (which finds
    // the last writer by user) offers no skip.
    it("keeps the device's passage as the last write after a merge into a writer in the story", async () => {
      setUp();
      clock.now = T0;
      const laptop = await account("user_last_writer");
      const storyId = await createStory(laptop, nameInTest("Ana"));
      const ben = anonymous();
      await joinStory(ben, storyId, nameInTest("Ben"));
      const phone = anonymous();
      await joinStory(phone, storyId, nameInTest("Ana on phone"));
      await writeAs(ben, storyId, 2);
      await writeAs(phone, storyId, 3);
      // The turn passed to the laptop; the phone skips it on to Ben.
      expect((await phone.post(`/api/stories/${storyId}/skip`, { turnVersion: 4 })).status).toBe(
        204,
      );
      await settle(laptop, phone, ben);

      expect((await signIn(phone, "user_last_writer")).status).toBe(204);
      await settle(phone);

      const asAccount = await readStory(laptop, storyId);
      expect(asAccount.turn.holderId).not.toBe(asAccount.me);
      expect(canSkipTurn(asAccount)).toBe(false);
      const skipped = await laptop.post(`/api/stories/${storyId}/skip`, {
        turnVersion: asAccount.turn.version,
      });
      expect(skipped.status).toBe(409);
      expect(await readError(skipped)).toBe("no_one_to_skip_to");
    });

    it("finishes when the device left the story while the merge was running", async () => {
      setUp();
      const laptop = await account("user_left_meanwhile");
      const storyId = await createStory(laptop, nameInTest("Ana"));
      const phone = anonymous();
      await joinStory(phone, storyId, nameInTest("Ana on phone"));
      await joinStory(anonymous(), storyId, nameInTest("Ben"));
      const deviceUserId = await userIdOf(testEnv.env.DB, phone);
      phone.sessionToken = await signSessionToken("user_left_meanwhile", ORIGIN);

      const response = await phone.put(
        PATH,
        {},
        { env: deviceLeavesAfterFirstLoad(env, storyId, deviceUserId) },
      );

      expect(response.status).toBe(204);
      expect((await participantRows(storyId)).map((row) => row.leftAt !== null)).toEqual([
        false,
        true,
        false,
      ]);
    });

    it("answers 409 stale_turn when other writes keep moving the story, and a retry finishes", async () => {
      setUp();
      const laptop = await account("user_stale");
      const storyId = await createStory(laptop, nameInTest("Ana"));
      const phone = anonymous();
      await joinStory(phone, storyId, nameInTest("Ana on phone"));
      await joinStory(anonymous(), storyId, nameInTest("Ben"));
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
      const storyId = await createStory(laptop, nameInTest("Ana"));
      const laptopEndpoint = await subscribe(laptop, "laptop-devices");
      const ben = anonymous();
      await joinStory(ben, storyId, nameInTest("Ben"));
      const phone = anonymous();
      const phoneStory = await createStory(phone, nameInTest("Ana on phone"));
      const phoneEndpoint = await subscribe(phone, "phone-devices");
      await signIn(phone, "user_devices");
      await settle(laptop, phone, ben);
      sender.sent.length = 0;
      const view = await readStory(ben, storyId);

      const written = await ben.post(`/api/stories/${storyId}/passages`, {
        text: "And then.",
        turnVersion: view.turn.version,
        startsParagraph: false,
      });
      await settle(ben);

      expect(written.status).toBe(201);
      expect(await storyIds(laptop)).toEqual([storyId, phoneStory].toSorted());
      expect(await storyIds(phone)).toEqual([storyId, phoneStory].toSorted());
      expect(sender.sent.map(({ subscription }) => subscription.endpoint).toSorted()).toEqual(
        [laptopEndpoint, phoneEndpoint].toSorted(),
      );
    });
  });

  describe("signing out", () => {
    it("removes the device's push subscription while the session is valid", async () => {
      setUp();
      const phone = anonymous();
      await createStory(phone);
      await signIn(phone, "user_sign_out_push");
      const endpoint = await subscribe(phone, "phone-sign-out");

      const removed = await deletePushSubscription(phone, endpoint);

      expect(removed.status).toBe(204);
      expect(await pushEndpoints()).not.toContain(endpoint);
    });

    it("drops the row on the next load after a session that ended elsewhere", async () => {
      setUp();
      const phone = anonymous();
      await createStory(phone);
      await signIn(phone, "user_ended_elsewhere");
      const endpoint = await subscribe(phone, "phone-ended");
      expect(await pushEndpoints()).toContain(endpoint);

      phone.sessionToken = null;
      const reload = await putPushSubscription(phone, {
        endpoint,
        keys: { p256dh: P256DH, auth: AUTH },
      });

      expect(reload.status).toBe(204);
      expect(await pushEndpoints()).not.toContain(endpoint);
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
      ["without an azp claim", () => account("user_x", { omitAuthorizedParty: true })],
      ["missing", () => Promise.resolve(anonymous())],
    ];

    it.each(cases)(
      "is refused with 401 and a challenge when the token is %s",
      async (name, make) => {
        setUp();
        const browser = await make();
        await createStory(createBrowser(app, env, ORIGIN));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const before = [await count("users"), await count("participants")];

        const response = await browser.put(PATH, {});

        expect(response.status).toBe(401);
        // RFC 6750: no credentials gets a bare challenge, a rejected token gets `error`.
        expect(response.headers.get("WWW-Authenticate")).toBe(
          name === "missing" ? "Bearer" : 'Bearer error="invalid_token"',
        );
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

// The first time the account is attached, another request has just claimed it.
function claimedJustBeforeAttach(base: Env, clerkUserId: string): Env {
  const db = base.DB;
  const raced = {
    batch: <T>(statements: D1PreparedStatement[]) => db.batch<T>(statements),
    prepare: (query: string) => {
      const statement = db.prepare(query);
      if (!query.includes("SET clerk_user_id")) {
        return statement;
      }

      return {
        bind: (...values: unknown[]) => ({
          run: async () => {
            await db
              .prepare("INSERT INTO users (id, clerk_user_id, created_at) VALUES (?, ?, 0)")
              .bind(`claimed-${clerkUserId}`, clerkUserId)
              .run();

            return statement.bind(...values).run();
          },
        }),
      };
    },
  };

  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, { DB: raced });
}

// After the merge first loads the story, the device user's participant leaves by another request,
// and that request also moves the turn version.
function deviceLeavesAfterFirstLoad(base: Env, storyId: string, userId: string): Env {
  const db = base.DB;
  let loads = 0;
  const racing = {
    prepare: (query: string) => db.prepare(query),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      const results = await db.batch<T>(statements);
      loads += 1;
      if (loads === 1) {
        await db
          .prepare("UPDATE participants SET left_at = 1 WHERE story_id = ? AND user_id = ?")
          .bind(storyId, userId)
          .run();
        await db
          .prepare("UPDATE stories SET turn_version = turn_version + 1 WHERE id = ?")
          .bind(storyId)
          .run();
      }

      return results;
    },
  };

  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, { DB: racing });
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

async function writeAs(browser: Browser, storyId: string, turnVersion: number): Promise<void> {
  const response = await browser.post(`/api/stories/${storyId}/passages`, {
    text: "And then.",
    turnVersion,
    startsParagraph: false,
  });
  expect(response.status).toBe(201);
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
  const response = await putPushSubscription(browser, {
    endpoint,
    keys: { p256dh: P256DH, auth: AUTH },
  });
  expect(response.status).toBe(204);

  return endpoint;
}

async function settle(...browsers: Browser[]): Promise<void> {
  await Promise.all(browsers.flatMap((browser) => browser.backgroundWork.splice(0)));
}
