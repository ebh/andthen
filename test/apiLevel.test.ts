import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { API_LEVEL } from "../src/shared/apiLevel";
import { fakeProvider } from "../src/worker/suggestions/fake";
import { createBrowser, createTestApp, readError, T0, type Clock } from "./support/browser";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const MIN = 3;

const OUTDATED = {
  status: 426,
  cacheControl: "no-store",
  body: { error: "client_outdated" },
};

async function refusal(
  response: Response,
): Promise<{ status: number; cacheControl: string | null; body: unknown }> {
  const body: unknown = await response.json();

  return { status: response.status, cacheControl: response.headers.get("Cache-Control"), body };
}

describe("the API level guard", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock, undefined, fakeProvider, MIN);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  const newBrowser = () => createBrowser(app, testEnv.env);

  describe("a level against the minimum", () => {
    it("refuses a level below it, on a read", async () => {
      const response = await newBrowser().get("/api/stories", { apiLevel: String(MIN - 1) });

      expect(await refusal(response)).toEqual(OUTDATED);
    });

    it("refuses a level below it, on a write, before the route runs", async () => {
      const browser = newBrowser();

      const response = await browser.post(
        "/api/stories",
        { displayName: "Ana", opening: "Once upon a time." },
        { apiLevel: String(MIN - 1) },
      );

      expect(await refusal(response)).toEqual(OUTDATED);
      expect(browser.cookies.size).toBe(0);
    });

    it("serves a level equal to it", async () => {
      const response = await newBrowser().get("/api/stories", { apiLevel: String(MIN) });

      expect(response.status).toBe(200);
    });

    it("serves a level above it", async () => {
      const response = await newBrowser().get("/api/stories", { apiLevel: String(MIN + 1) });

      expect(response.status).toBe(200);
    });
  });

  describe("a header that is absent or malformed", () => {
    it("serves a request with no header", async () => {
      const response = await newBrowser().get("/api/stories", { apiLevel: null });

      expect(response.status).toBe(200);
    });

    it.each(["abc", "", "0", "-1", "1.5", "03"])("refuses %j as bad_request", async (value) => {
      const response = await newBrowser().get("/api/stories", { apiLevel: value });

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
    });
  });

  describe("the paths it covers", () => {
    it("lets /api/health answer a stale or malformed level", async () => {
      for (const apiLevel of [String(MIN - 1), "abc"]) {
        const response = await newBrowser().get("/api/health", { apiLevel });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "ok" });
      }
    });

    it("refuses a stale level on an unknown /api path before answering not_found", async () => {
      const response = await newBrowser().get("/api/nope", { apiLevel: String(MIN - 1) });

      expect(await refusal(response)).toEqual(OUTDATED);
    });

    it("answers not_found for an unknown /api path at a current level", async () => {
      const response = await newBrowser().get("/api/nope", { apiLevel: String(MIN) });

      expect(response.status).toBe(404);
    });

    it("refuses a stale level before the origin check", async () => {
      const response = await newBrowser().post(
        "/api/stories",
        { displayName: "Ana", opening: "Once." },
        { origin: "https://evil.example", apiLevel: String(MIN - 1) },
      );

      expect(await refusal(response)).toEqual(OUTDATED);
    });

    it("refuses a stale level before the content-type and body checks", async () => {
      const response = await newBrowser().post("/api/stories", undefined, {
        contentType: "text/plain",
        rawBody: "not json",
        apiLevel: String(MIN - 1),
      });

      expect(await refusal(response)).toEqual(OUTDATED);
    });

    it("still reports a bad origin at a current level", async () => {
      const response = await newBrowser().post(
        "/api/stories",
        { displayName: "Ana", opening: "Once." },
        { origin: "https://evil.example", apiLevel: String(MIN) },
      );

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("forbidden_origin");
    });

    it("refuses a stale live-socket upgrade with 426 client_outdated", async () => {
      // The story doesn't exist: only the level check, which runs first, can explain the 426.
      const response = await newBrowser().get("/api/stories/zzzzz/live", {
        headers: { Upgrade: "websocket", Origin: "http://localhost" },
        apiLevel: String(MIN - 1),
      });

      expect(await refusal(response)).toEqual(OUTDATED);
    });
  });

  describe("a browser that sends no level option", () => {
    it("sends the current API level", async () => {
      const current = createTestApp(clock, undefined, fakeProvider, API_LEVEL);
      const browser = createBrowser(current, testEnv.env);

      const response = await browser.get("/api/stories");

      expect(response.status).toBe(200);
    });

    it("is refused once the minimum passes the current level", async () => {
      const raised = createTestApp(clock, undefined, fakeProvider, API_LEVEL + 1);
      const browser = createBrowser(raised, testEnv.env);

      expect(await refusal(await browser.get("/api/stories"))).toEqual(OUTDATED);
    });
  });
});
