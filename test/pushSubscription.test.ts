import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { z } from "zod";

import { pushKeyResponseSchema } from "../src/shared/api";
import { pushSubscriptionIdOf } from "../src/shared/pushSubscriptionId";
import { loadPushSubscriptions } from "../src/worker/db/pushRepo";
import { findUserByClerkUserId } from "../src/worker/db/userRepo";
import {
  createBrowser,
  createStory,
  createTestApp,
  readError,
  T0,
  type Browser,
  type Clock,
} from "./support/browser";
import { deletePushSubscription, putPushSubscription } from "./support/pushSubscriptions";
import { signSessionToken } from "./support/sessionToken";
import { createTestEnv, type TestEnv } from "./support/testEnv";
import { userIdOf } from "./support/users";

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const ENDPOINT = "https://fcm.googleapis.com/send/one";
const SUBSCRIPTION = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };
const PATH = "/api/push-subscriptions";

async function pathOf(endpoint: string): Promise<string> {
  return `${PATH}/${await pushSubscriptionIdOf(endpoint)}`;
}

describe("push subscription routes", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  const newBrowser = () => createBrowser(app, testEnv.env);

  // A browser that has a cookie because it started a story.
  async function browserWithCookie(): Promise<{ browser: Browser; hash: string }> {
    const browser = newBrowser();
    await createStory(browser);

    return { browser, hash: await userIdOf(testEnv.env.DB, browser) };
  }

  const storedFor = (userId: string) => loadPushSubscriptions(testEnv.env.DB, userId);

  async function storedEndpoints(endpoint: string): Promise<string[]> {
    const stored = await testEnv.env.DB.prepare(
      "SELECT endpoint FROM push_subscriptions WHERE endpoint = ?",
    )
      .bind(endpoint)
      .all();

    return z
      .array(z.object({ endpoint: z.string() }))
      .parse(stored.results)
      .map((row) => row.endpoint);
  }

  describe("PUT /api/push-subscriptions/:pushSubscriptionId", () => {
    it("saves the subscription for the browser's token and answers 204", async () => {
      const { browser, hash } = await browserWithCookie();

      const response = await putPushSubscription(browser, SUBSCRIPTION);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(await storedFor(hash)).toEqual([{ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH }]);
    });

    it("records the time of the first save and ignores a browser's extra fields", async () => {
      const { browser } = await browserWithCookie();
      const endpoint = "https://fcm.googleapis.com/send/timed";

      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint, expirationTime: null });
      clock.now = T0 + 5000;
      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint });

      const stored = await testEnv.env.DB.prepare(
        "SELECT created_at FROM push_subscriptions WHERE endpoint = ?",
      )
        .bind(endpoint)
        .all();
      expect(stored.results).toEqual([{ created_at: T0 }]);
      clock.now = T0;
    });

    it("saving the same endpoint again keeps one row and takes the new keys", async () => {
      const { browser, hash } = await browserWithCookie();
      const endpoint = "https://fcm.googleapis.com/send/again";

      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint });
      const newAuth = "z".repeat(22);
      const response = await putPushSubscription(browser, {
        endpoint,
        keys: { p256dh: P256DH, auth: newAuth },
      });

      expect(response.status).toBe(204);
      expect(await storedFor(hash)).toEqual([{ endpoint, p256dh: P256DH, auth: newAuth }]);
    });

    it("keeps one browser's several endpoints", async () => {
      const { browser, hash } = await browserWithCookie();
      const [first, second] = ["https://fcm.googleapis.com/a", "https://fcm.googleapis.com/b"];

      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint: first });
      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint: second });

      expect((await storedFor(hash)).map(({ endpoint }) => endpoint)).toEqual([first, second]);
    });

    it("moves an endpoint to the browser that saves it last", async () => {
      const [{ browser: first, hash: firstHash }, { browser: second, hash: secondHash }] =
        await Promise.all([browserWithCookie(), browserWithCookie()]);
      const endpoint = "https://fcm.googleapis.com/send/shared";

      await putPushSubscription(first, { ...SUBSCRIPTION, endpoint });
      await putPushSubscription(second, { ...SUBSCRIPTION, endpoint });

      expect(await storedFor(firstHash)).toEqual([]);
      expect(await storedFor(secondHash)).toHaveLength(1);
    });

    it("answers 204 to a browser with no user, saves nothing and issues no cookie", async () => {
      const browser = newBrowser();
      const endpoint = "https://fcm.googleapis.com/send/cookieless";

      const response = await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint });

      expect(response.status).toBe(204);
      expect(browser.cookies.size).toBe(0);
      expect(await storedEndpoints(endpoint)).toEqual([]);
    });

    it("drops the row at its endpoint when a browser with no user sends it", async () => {
      const { browser, hash } = await browserWithCookie();
      const endpoint = "https://fcm.googleapis.com/send/signed-out-elsewhere";
      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint });
      const reloaded = newBrowser();

      const response = await putPushSubscription(reloaded, { ...SUBSCRIPTION, endpoint });

      expect(response.status).toBe(204);
      expect(await storedFor(hash)).toEqual([]);
    });

    it("saves for the account user a session token names, with no cookie", async () => {
      const browser = newBrowser();
      browser.sessionToken = await signSessionToken("user_push", "http://localhost");
      await createStory(browser);
      const endpoint = "https://fcm.googleapis.com/send/account";

      const response = await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint });

      expect(response.status).toBe(204);
      const user = await findUserByClerkUserId(testEnv.env.DB, "user_push");
      expect((await storedFor(user?.id ?? "")).map((row) => row.endpoint)).toEqual([endpoint]);
    });

    it("refuses a rejected session token rather than dropping the row", async () => {
      const { browser } = await browserWithCookie();
      const endpoint = "https://fcm.googleapis.com/send/kept";
      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint });
      const expired = newBrowser();
      expired.sessionToken = await signSessionToken("user_push", "http://localhost", {
        expiresInSeconds: -120,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const response = await putPushSubscription(expired, { ...SUBSCRIPTION, endpoint });

      expect(response.status).toBe(401);
      expect(await readError(response)).toBe("invalid_session_token");
      expect(await storedEndpoints(endpoint)).toEqual([endpoint]);
      warn.mockRestore();
    });

    it.each([
      ["an http endpoint", { ...SUBSCRIPTION, endpoint: "http://fcm.googleapis.com/x" }],
      ["an unknown push host", { ...SUBSCRIPTION, endpoint: "https://push.example.test/x" }],
      ["a malformed key", { ...SUBSCRIPTION, keys: { p256dh: "short", auth: AUTH } }],
      ["no keys", { endpoint: ENDPOINT }],
      ["a non-object body", []],
    ])("answers 400 bad_request for %s", async (_name, body) => {
      const { browser } = await browserWithCookie();

      const response = await putPushSubscription(browser, body);

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
    });

    it("answers 400 bad_request when the ID in the path is not the hash of the endpoint", async () => {
      const { browser, hash } = await browserWithCookie();

      const response = await browser.put(
        await pathOf("https://fcm.googleapis.com/other"),
        SUBSCRIPTION,
      );

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
      expect(await storedFor(hash)).toEqual([]);
    });

    it("checks the body before the cookie, as other routes do", async () => {
      const response = await putPushSubscription(newBrowser(), { endpoint: "nope" });

      expect(response.status).toBe(400);
    });

    it("refuses another origin, a wrong content type and an oversize body", async () => {
      const { browser } = await browserWithCookie();

      const foreign = await putPushSubscription(browser, SUBSCRIPTION, {
        origin: "https://evil.example",
      });
      const noOrigin = await putPushSubscription(browser, SUBSCRIPTION, { origin: null });
      const wrongType = await putPushSubscription(browser, SUBSCRIPTION, {
        contentType: "text/plain",
      });
      const tooBig = await putPushSubscription(browser, undefined, {
        rawBody: "x".repeat(9 * 1024),
      });

      expect([foreign.status, noOrigin.status, wrongType.status, tooBig.status]).toEqual([
        403, 403, 400, 413,
      ]);
      expect(await readError(foreign)).toBe("forbidden_origin");
    });
  });

  describe("DELETE /api/push-subscriptions/:pushSubscriptionId", () => {
    it("removes the browser's own subscription and answers 204", async () => {
      const { browser, hash } = await browserWithCookie();
      await putPushSubscription(browser, SUBSCRIPTION);

      const response = await deletePushSubscription(browser, ENDPOINT);

      expect(response.status).toBe(204);
      expect(await storedFor(hash)).toEqual([]);
    });

    it("leaves the browser's other subscriptions alone", async () => {
      const { browser, hash } = await browserWithCookie();
      const keep = "https://fcm.googleapis.com/keep";
      await putPushSubscription(browser, SUBSCRIPTION);
      await putPushSubscription(browser, { ...SUBSCRIPTION, endpoint: keep });

      await deletePushSubscription(browser, ENDPOINT);

      expect((await storedFor(hash)).map(({ endpoint }) => endpoint)).toEqual([keep]);
    });

    it("answers 204 for an endpoint that isn't stored, and leaves another browser's alone", async () => {
      const [{ browser: owner, hash }, { browser: other }] = await Promise.all([
        browserWithCookie(),
        browserWithCookie(),
      ]);
      const endpoint = "https://fcm.googleapis.com/send/owned";
      await putPushSubscription(owner, { ...SUBSCRIPTION, endpoint });

      const unknown = await deletePushSubscription(other, "https://fcm.googleapis.com/none");
      const notYours = await deletePushSubscription(other, endpoint);

      expect([unknown.status, notYours.status]).toEqual([204, 204]);
      expect(await storedFor(hash)).toHaveLength(1);
    });

    it("answers 204 to a browser with no cookie, deletes nothing and issues no cookie", async () => {
      const { browser, hash } = await browserWithCookie();
      const cookieless = newBrowser();
      await putPushSubscription(browser, SUBSCRIPTION);

      const response = await deletePushSubscription(cookieless, ENDPOINT);

      expect(response.status).toBe(204);
      expect(cookieless.cookies.size).toBe(0);
      expect(await storedFor(hash)).toHaveLength(1);
    });

    it("answers 400 bad_request to a DELETE that sends a body", async () => {
      const { browser, hash } = await browserWithCookie();
      await putPushSubscription(browser, SUBSCRIPTION);

      const response = await browser.delete(await pathOf(ENDPOINT), { endpoint: ENDPOINT });

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
      expect(await storedFor(hash)).toHaveLength(1);
    });

    it("answers 404 not_found for an ID that can't be a push subscription ID", async () => {
      const { browser } = await browserWithCookie();

      const response = await browser.delete(`${PATH}/not-an-id`);

      expect(response.status).toBe(404);
      expect(await readError(response)).toBe("not_found");
    });

    it("refuses another origin", async () => {
      const { browser } = await browserWithCookie();

      const response = await deletePushSubscription(browser, ENDPOINT, {
        origin: "https://evil.example",
      });

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/push-key", () => {
    it("returns the public key from the environment, to a browser with no cookie", async () => {
      const browser = newBrowser();

      const response = await browser.get("/api/push-key");

      expect(response.status).toBe(200);
      expect(pushKeyResponseSchema.parse(await response.json())).toEqual({
        publicKey: testEnv.env.VAPID_PUBLIC_KEY,
      });
      expect(browser.cookies.size).toBe(0);
    });

    it("answers 500 internal_error when the public key is missing", async () => {
      const response = await newBrowser().get("/api/push-key", {
        env: { ...testEnv.env, VAPID_PUBLIC_KEY: undefined },
      });

      expect(response.status).toBe(500);
      expect(await readError(response)).toBe("internal_error");
    });
  });
});
