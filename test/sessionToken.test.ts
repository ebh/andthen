import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { myStoriesResponseSchema } from "../src/shared/api";
import { findUserByClerkUserId } from "../src/worker/db/userRepo";
import { selectSessionVerifier } from "../src/worker/sessionToken";
import {
  createBrowser,
  createStory,
  createTestApp,
  readError,
  T0,
  type Browser,
  type Clock,
  nameInTest,
} from "./support/browser";
import { signSessionToken, type SessionTokenOptions } from "./support/sessionToken";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const ORIGIN = "http://localhost";

describe("the session verifier", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("returns the Clerk user id of a valid token", async () => {
    const verify = selectSessionVerifier(testEnv.env);

    const verdict = await verify(await signSessionToken("user_verified", ORIGIN), ORIGIN);

    expect(verdict).toEqual({ type: "valid", clerkUserId: "user_verified" });
  });

  it("rejects with a reason for the server log and never throws", async () => {
    const verify = selectSessionVerifier(testEnv.env);

    const verdict = await verify(await signSessionToken("user_x", "https://evil.example"), ORIGIN);

    expect(verdict.type).toBe("rejected");
    expect(verdict.type === "rejected" ? verdict.reason.trim() : "").not.toBe("");
  });

  it("rejects a token with no azp claim, whose origin Clerk would not check", async () => {
    const verify = selectSessionVerifier(testEnv.env);

    const verdict = await verify(
      await signSessionToken("user_x", ORIGIN, { omitAuthorizedParty: true }),
      ORIGIN,
    );

    expect(verdict.type).toBe("rejected");
  });

  it("rejects every token when the key is not a public key", async () => {
    const env = { ...testEnv.env };
    Object.defineProperty(env, "CLERK_JWT_KEY", { value: "not-a-public-key", enumerable: true });
    const verify = selectSessionVerifier(env);

    const verdict = await verify(await signSessionToken("user_x", ORIGIN), ORIGIN);

    expect(verdict.type).toBe("rejected");
  });
});

describe("session tokens", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  function newBrowser(): Browser {
    return createBrowser(app, testEnv.env, ORIGIN);
  }

  async function signedIn(clerkUserId: string, options?: SessionTokenOptions): Promise<Browser> {
    const browser = newBrowser();
    browser.sessionToken = await signSessionToken(clerkUserId, ORIGIN, options);

    return browser;
  }

  describe("a valid token", () => {
    it("reads as a user with no stories and issues no cookie", async () => {
      const browser = await signedIn("user_reads");

      const response = await browser.get("/api/stories");

      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await storyIds(browser)).toEqual([]);
    });

    it("makes an account user on the first write, once, and issues no cookie", async () => {
      const first = await signedIn("user_writes");
      const second = await signedIn("user_writes");

      const storyId = await createStory(first);
      // The account user already has a name from the first story, so this one sends none.
      const again = await second.post("/api/stories", { opening: "Once more." });
      expect(again.status).toBe(201);

      expect(first.cookies.size).toBe(0);
      const users = await testEnv.env.DB.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE clerk_user_id = ?",
      )
        .bind("user_writes")
        .first();
      expect(z.object({ count: z.number() }).parse(users).count).toBe(1);
      expect(await storyIds(second)).toContain(storyId);
    });

    it("finds the same account user from another browser with no cookie", async () => {
      const phone = await signedIn("user_two_devices");
      const storyId = await createStory(phone);
      const laptop = await signedIn("user_two_devices");

      expect(await storyIds(laptop)).toEqual([storyId]);
      expect(await findUserByClerkUserId(testEnv.env.DB, "user_two_devices")).not.toBeNull();
    });

    it("decides alone: the browser token's user is not consulted", async () => {
      const anonymous = newBrowser();
      await createStory(anonymous);
      anonymous.sessionToken = await signSessionToken("user_not_the_cookie", ORIGIN);

      expect(await storyIds(anonymous)).toEqual([]);
    });
  });

  describe("a token that is present and bad", () => {
    const cases: [string, () => Promise<string>][] = [
      ["expired", () => signSessionToken("user_x", ORIGIN, { expiresInSeconds: -120 })],
      [
        "signed by another key",
        () => signSessionToken("user_x", ORIGIN, { signWithOtherKey: true }),
      ],
      ["issued for another origin", () => signSessionToken("user_x", "https://evil.example")],
      [
        "without an azp claim",
        () => signSessionToken("user_x", ORIGIN, { omitAuthorizedParty: true }),
      ],
      ["malformed", () => Promise.resolve("not-a-jwt")],
    ];

    it.each(cases)("is refused with 401 and a challenge when %s", async (_name, makeToken) => {
      const browser = newBrowser();
      browser.sessionToken = await makeToken();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const response = await browser.get("/api/stories");

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer error="invalid_token"');
      expect(await readError(response)).toBe("invalid_session_token");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Session token rejected: "));
      warn.mockRestore();
    });

    it("never falls back to the browser token", async () => {
      const browser = newBrowser();
      const storyId = await createStory(browser);
      browser.sessionToken = "not-a-jwt";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const response = await browser.get(`/api/stories/${storyId}`);

      expect(response.status).toBe(401);
      warn.mockRestore();
    });

    it("refuses an Authorization header that is not a Bearer token", async () => {
      const browser = newBrowser();

      const response = await browser.get("/api/stories", {
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer error="invalid_token"');
      expect(await readError(response)).toBe("invalid_session_token");
    });

    it("issues no cookie and creates nothing on a write", async () => {
      const browser = newBrowser();
      browser.sessionToken = await signSessionToken("user_x", ORIGIN, { expiresInSeconds: -120 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const response = await browser.post("/api/stories", {
        displayName: nameInTest("Ana"),
        opening: "Once upon a time.",
      });

      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await findUserByClerkUserId(testEnv.env.DB, "user_x")).toBeNull();
      warn.mockRestore();
    });
  });
});

async function storyIds(browser: Browser): Promise<string[]> {
  const response = await browser.get("/api/stories");
  expect(response.status).toBe(200);

  return myStoriesResponseSchema.parse(await response.json()).stories.map((story) => story.id);
}
