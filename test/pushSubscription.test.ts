import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pushKeyResponseSchema } from "../src/shared/api";
import { hashBrowserToken } from "../src/worker/cookies";
import { loadPushSubscriptions } from "../src/worker/db/pushRepo";
import {
  createBrowser,
  createStory,
  createTestApp,
  readError,
  T0,
  type Browser,
  type Clock,
} from "./support/browser";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const P256DH = "B".repeat(87);
const AUTH = "a".repeat(22);
const ENDPOINT = "https://push.example.test/send/one";
const SUBSCRIPTION = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };
const PATH = "/api/push-subscription";

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
    const token = browser.cookies.get("andthen_bt") ?? "";

    return { browser, hash: await hashBrowserToken(token) };
  }

  const storedFor = (hash: string) => loadPushSubscriptions(testEnv.env.DB, hash);

  describe("PUT /api/push-subscription", () => {
    it("saves the subscription for the browser's token and answers 204", async () => {
      const { browser, hash } = await browserWithCookie();

      const response = await browser.put(PATH, SUBSCRIPTION);

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(await storedFor(hash)).toEqual([{ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH }]);
    });

    it("records the time of the first save and ignores a browser's extra fields", async () => {
      const { browser } = await browserWithCookie();
      const endpoint = "https://push.example.test/send/timed";

      await browser.put(PATH, { ...SUBSCRIPTION, endpoint, expirationTime: null });
      clock.now = T0 + 5000;
      await browser.put(PATH, { ...SUBSCRIPTION, endpoint });

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
      const endpoint = "https://push.example.test/send/again";

      await browser.put(PATH, { ...SUBSCRIPTION, endpoint });
      const newAuth = "z".repeat(22);
      const response = await browser.put(PATH, {
        endpoint,
        keys: { p256dh: P256DH, auth: newAuth },
      });

      expect(response.status).toBe(204);
      expect(await storedFor(hash)).toEqual([{ endpoint, p256dh: P256DH, auth: newAuth }]);
    });

    it("keeps one browser's several endpoints", async () => {
      const { browser, hash } = await browserWithCookie();
      const [first, second] = ["https://push.example.test/a", "https://push.example.test/b"];

      await browser.put(PATH, { ...SUBSCRIPTION, endpoint: first });
      await browser.put(PATH, { ...SUBSCRIPTION, endpoint: second });

      expect((await storedFor(hash)).map(({ endpoint }) => endpoint)).toEqual([first, second]);
    });

    it("moves an endpoint to the browser that saves it last", async () => {
      const [{ browser: first, hash: firstHash }, { browser: second, hash: secondHash }] =
        await Promise.all([browserWithCookie(), browserWithCookie()]);
      const endpoint = "https://push.example.test/send/shared";

      await first.put(PATH, { ...SUBSCRIPTION, endpoint });
      await second.put(PATH, { ...SUBSCRIPTION, endpoint });

      expect(await storedFor(firstHash)).toEqual([]);
      expect(await storedFor(secondHash)).toHaveLength(1);
    });

    it("answers 403 not_participant to a browser with no cookie, and saves nothing", async () => {
      const browser = newBrowser();
      const endpoint = "https://push.example.test/send/cookieless";

      const response = await browser.put(PATH, { ...SUBSCRIPTION, endpoint });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
      expect(browser.cookies.size).toBe(0);
      const stored = await testEnv.env.DB.prepare(
        "SELECT 1 FROM push_subscriptions WHERE endpoint = ?",
      )
        .bind(endpoint)
        .all();
      expect(stored.results).toEqual([]);
    });

    it.each([
      ["an http endpoint", { ...SUBSCRIPTION, endpoint: "http://push.example.test/x" }],
      ["a malformed key", { ...SUBSCRIPTION, keys: { p256dh: "short", auth: AUTH } }],
      ["no keys", { endpoint: ENDPOINT }],
      ["a non-object body", []],
    ])("answers 400 bad_request for %s", async (_name, body) => {
      const { browser } = await browserWithCookie();

      const response = await browser.put(PATH, body);

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
    });

    it("checks the body before the cookie, as other routes do", async () => {
      const response = await newBrowser().put(PATH, { endpoint: "nope" });

      expect(response.status).toBe(400);
    });

    it("refuses another origin, a wrong content type and an oversize body", async () => {
      const { browser } = await browserWithCookie();

      const foreign = await browser.put(PATH, SUBSCRIPTION, { origin: "https://evil.example" });
      const noOrigin = await browser.put(PATH, SUBSCRIPTION, { origin: null });
      const wrongType = await browser.put(PATH, SUBSCRIPTION, { contentType: "text/plain" });
      const tooBig = await browser.put(PATH, undefined, { rawBody: "x".repeat(9 * 1024) });

      expect([foreign.status, noOrigin.status, wrongType.status, tooBig.status]).toEqual([
        403, 403, 400, 413,
      ]);
      expect(await readError(foreign)).toBe("forbidden_origin");
    });
  });

  describe("DELETE /api/push-subscription", () => {
    it("removes the browser's own subscription and answers 204", async () => {
      const { browser, hash } = await browserWithCookie();
      await browser.put(PATH, SUBSCRIPTION);

      const response = await browser.delete(PATH, { endpoint: ENDPOINT });

      expect(response.status).toBe(204);
      expect(await storedFor(hash)).toEqual([]);
    });

    it("leaves the browser's other subscriptions alone", async () => {
      const { browser, hash } = await browserWithCookie();
      const keep = "https://push.example.test/keep";
      await browser.put(PATH, SUBSCRIPTION);
      await browser.put(PATH, { ...SUBSCRIPTION, endpoint: keep });

      await browser.delete(PATH, { endpoint: ENDPOINT });

      expect((await storedFor(hash)).map(({ endpoint }) => endpoint)).toEqual([keep]);
    });

    it("answers 204 for an endpoint that isn't stored, and leaves another browser's alone", async () => {
      const [{ browser: owner, hash }, { browser: other }] = await Promise.all([
        browserWithCookie(),
        browserWithCookie(),
      ]);
      const endpoint = "https://push.example.test/send/owned";
      await owner.put(PATH, { ...SUBSCRIPTION, endpoint });

      const unknown = await other.delete(PATH, { endpoint: "https://push.example.test/none" });
      const notYours = await other.delete(PATH, { endpoint });

      expect([unknown.status, notYours.status]).toEqual([204, 204]);
      expect(await storedFor(hash)).toHaveLength(1);
    });

    it("answers 204 to a browser with no cookie, deletes nothing and issues no cookie", async () => {
      const { browser, hash } = await browserWithCookie();
      const cookieless = newBrowser();
      await browser.put(PATH, SUBSCRIPTION);

      const response = await cookieless.delete(PATH, { endpoint: ENDPOINT });

      expect(response.status).toBe(204);
      expect(cookieless.cookies.size).toBe(0);
      expect(await storedFor(hash)).toHaveLength(1);
    });

    it("answers 400 bad_request for a body without an https endpoint", async () => {
      const { browser } = await browserWithCookie();

      for (const body of [{}, { endpoint: "http://push.example.test/x" }, { endpoint: 5 }]) {
        const response = await browser.delete(PATH, body);

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe("bad_request");
      }
    });

    it("refuses another origin", async () => {
      const { browser } = await browserWithCookie();

      const response = await browser.delete(
        PATH,
        { endpoint: ENDPOINT },
        { origin: "https://evil.example" },
      );

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/push-subscription/key", () => {
    it("returns the public key from the environment, to a browser with no cookie", async () => {
      const browser = newBrowser();

      const response = await browser.get(`${PATH}/key`);

      expect(response.status).toBe(200);
      expect(pushKeyResponseSchema.parse(await response.json())).toEqual({
        publicKey: testEnv.env.VAPID_PUBLIC_KEY,
      });
      expect(browser.cookies.size).toBe(0);
    });

    it("answers 500 internal_error when the public key is missing", async () => {
      const response = await newBrowser().get(`${PATH}/key`, {
        env: { ...testEnv.env, VAPID_PUBLIC_KEY: undefined },
      });

      expect(response.status).toBe(500);
      expect(await readError(response)).toBe("internal_error");
    });
  });
});
