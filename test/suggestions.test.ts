import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { suggestionsResponseSchema } from "../src/shared/api";
import { createApp } from "../src/worker/app";
import { SUGGESTION_LIMIT, SUGGESTION_WINDOW_MS } from "../src/worker/config";
import { FAKE_SUGGESTIONS } from "../src/worker/suggestions/fake";
import type { SuggestionProvider, SuggestionResult } from "../src/worker/suggestions/provider";
import { selectSuggestionProvider } from "../src/worker/suggestions/select";
import type { RunModel } from "../src/worker/suggestions/workersAi";
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
import { gateLoads } from "./support/gatedDb";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const HOUR = SUGGESTION_WINDOW_MS;
const MINUTE = 60 * 1000;

const GOOD: SuggestionResult = { ok: true, suggestions: ["One.", "Two.", "Three."] };

// A provider the test controls: what it answers, and what story text it was shown.
const goodAnswer = (): SuggestionResult => GOOD;

function ask(browser: Browser, storyId: string, options?: Parameters<Browser["post"]>[2]) {
  return browser.post(`/api/stories/${storyId}/suggestions`, undefined, options);
}

// The Env the test bed built, plus extra variables and bindings.
function envWith(base: Env, vars: object): Env {
  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, vars);
}

function scriptedProvider(answer: () => SuggestionResult = () => GOOD): {
  provider: SuggestionProvider;
  seen: string[];
} {
  const seen: string[] = [];

  return {
    seen,
    provider: {
      suggest: (storyText) => {
        seen.push(storyText);
        return Promise.resolve(answer());
      },
    },
  };
}

describe("POST /api/stories/:id/suggestions", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  let answer = goodAnswer;
  const { provider, seen } = scriptedProvider(() => answer());
  const app = createTestApp(clock, undefined, provider);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  afterEach(() => {
    answer = goodAnswer;
    seen.length = 0;
    vi.restoreAllMocks();
  });

  const newBrowser = () => createBrowser(app, testEnv.env);

  interface Pair {
    storyId: string;
    ana: Browser;
    ben: Browser;
    benId: string;
  }

  // Ana created the story and Ben joined, so Ben holds the turn. Fresh people each time, so
  // one test's quota never reaches another's.
  async function twoPersonStory(): Promise<Pair> {
    clock.now = T0;
    const [ana, ben] = [newBrowser(), newBrowser()];
    const storyId = await createStory(ana, "Ana", "Opening line.");
    const benId = await joinStory(ben, storyId, "Ben");

    return { storyId, ana, ben, benId };
  }

  async function requestCount(participantId: string): Promise<number> {
    const result = await testEnv.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM suggestion_requests WHERE participant_id = ?",
    )
      .bind(participantId)
      .all();

    return z.array(z.object({ n: z.number() })).parse(result.results)[0]?.n ?? -1;
  }

  describe("for the turn holder", () => {
    it("returns three suggestions, uncached", async () => {
      const { storyId, ben } = await twoPersonStory();

      const response = await ask(ben, storyId);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(suggestionsResponseSchema.parse(await response.json()).suggestions).toEqual([
        "One.",
        "Two.",
        "Three.",
      ]);
    });

    it("works with the default fake provider", async () => {
      const fakeApp = createTestApp(clock);
      clock.now = T0;
      const [ana, ben] = [createBrowser(fakeApp, testEnv.env), createBrowser(fakeApp, testEnv.env)];
      const storyId = await createStory(ana);
      await joinStory(ben, storyId, "Ben");

      const response = await ask(ben, storyId);

      expect(suggestionsResponseSchema.parse(await response.json()).suggestions).toEqual(
        FAKE_SUGGESTIONS,
      );
    });

    it("shows the provider the whole story, passages in order", async () => {
      const { storyId, ana, ben } = await twoPersonStory();
      expect((await readStory(ben, storyId)).turn.version).toBe(1);
      await ben.post(`/api/stories/${storyId}/contributions`, {
        text: "Ben adds this.",
        turnVersion: 1,
      });

      await ask(ana, storyId);

      expect(seen).toEqual(["Opening line.\n\nBen adds this."]);
    });

    it("changes nothing in the story and does not touch the turn", async () => {
      const { storyId, ben } = await twoPersonStory();
      const before = await readStory(ben, storyId);

      await ask(ben, storyId);
      await ask(ben, storyId);

      expect(await readStory(ben, storyId)).toEqual(before);
    });

    it("still lets the holder contribute at the version they saw", async () => {
      const { storyId, ben } = await twoPersonStory();
      const { turn } = await readStory(ben, storyId);

      await ask(ben, storyId);
      const response = await ben.post(`/api/stories/${storyId}/contributions`, {
        text: "Mine.",
        turnVersion: turn.version,
      });

      expect(response.status).toBe(204);
    });

    it("accepts a request with no body", async () => {
      const { storyId, ben } = await twoPersonStory();

      const response = await ask(ben, storyId, { rawBody: "" });

      expect(response.status).toBe(200);
    });
  });

  describe("who may ask", () => {
    it("refuses a participant who does not hold the turn", async () => {
      const { storyId, ana } = await twoPersonStory();

      const response = await ask(ana, storyId);

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_your_turn");
      expect(seen).toEqual([]);
    });

    it("refuses anyone while the story is waiting for a joiner", async () => {
      clock.now = T0;
      const ana = newBrowser();
      const storyId = await createStory(ana);

      const response = await ask(ana, storyId);

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_your_turn");
    });

    it("refuses a browser that is not in the story, with or without a cookie", async () => {
      const { storyId, ana } = await twoPersonStory();
      const stranger = newBrowser();
      await createStory(stranger, "Zed");

      for (const browser of [stranger, newBrowser()]) {
        const response = await ask(browser, storyId);

        expect(response.status).toBe(403);
        expect(await readError(response)).toBe("not_participant");
      }
      expect(ana.cookies.size).toBe(1);
    });

    it("answers 404 for an unknown story and for text that is not an ID", async () => {
      const browser = newBrowser();

      for (const id of ["zzzzz", "abc", "ab-12"]) {
        const response = await ask(browser, id);

        expect(response.status).toBe(404);
        expect(await readError(response)).toBe("not_found");
      }
    });

    it("applies the Origin and Content-Type guards", async () => {
      const { storyId, ben } = await twoPersonStory();

      const wrongOrigin = await ask(ben, storyId, { origin: "https://evil.example" });
      const noOrigin = await ask(ben, storyId, { origin: null });
      const wrongType = await ask(ben, storyId, { contentType: "text/plain" });

      expect([wrongOrigin.status, noOrigin.status]).toEqual([403, 403]);
      expect(await readError(wrongOrigin)).toBe("forbidden_origin");
      expect(wrongType.status).toBe(400);
      expect(await readError(wrongType)).toBe("bad_request");
      expect(seen).toEqual([]);
    });

    it("follows the resolved turn when the stored holder has timed out", async () => {
      // Ben's turn runs out and passes to Cat, the next in rotation (Ana wrote last).
      const { storyId, ben } = await twoPersonStory();
      const cat = newBrowser();
      await joinStory(cat, storyId, "Cat");

      clock.now = T0 + 24 * HOUR;
      const staleHolder = await ask(ben, storyId);
      const newHolder = await ask(cat, storyId);

      expect(staleHolder.status).toBe(403);
      expect(await readError(staleHolder)).toBe("not_your_turn");
      expect(newHolder.status).toBe(200);
    });

    it("still answers at the last moment of the turn", async () => {
      const { storyId, ben } = await twoPersonStory();

      clock.now = T0 + 24 * HOUR - 1;

      expect((await ask(ben, storyId)).status).toBe(200);
    });
  });

  describe("the hourly limit", () => {
    it("allows three requests and answers the fourth with 429", async () => {
      const { storyId, ben, benId } = await twoPersonStory();

      for (let n = 0; n < SUGGESTION_LIMIT; n += 1) {
        expect((await ask(ben, storyId)).status).toBe(200);
      }
      const fourth = await ask(ben, storyId);

      expect(fourth.status).toBe(429);
      expect(await readError(fourth)).toBe("ai_rate_limited");
      expect(await requestCount(benId)).toBe(SUGGESTION_LIMIT);
      expect(seen).toHaveLength(SUGGESTION_LIMIT);
    });

    it("counts each participant on their own", async () => {
      const { storyId, ana, ben } = await twoPersonStory();
      for (let n = 0; n < SUGGESTION_LIMIT; n += 1) {
        await ask(ben, storyId);
      }
      await ben.post(`/api/stories/${storyId}/contributions`, { text: "Mine.", turnVersion: 1 });

      expect((await ask(ana, storyId)).status).toBe(200);
    });

    it("counts per participant across stories", async () => {
      const first = await twoPersonStory();
      for (let n = 0; n < SUGGESTION_LIMIT; n += 1) {
        await ask(first.ben, first.storyId);
      }
      const second = await createStory(first.ana, "Ana");
      await first.ben.post(`/api/stories/${second}/participants`, { displayName: "Ben" });

      expect((await ask(first.ben, second)).status).toBe(200);
    });

    it("frees a slot exactly one hour after the request that used it", async () => {
      const { storyId, ben } = await twoPersonStory();
      await ask(ben, storyId);
      clock.now = T0 + 20 * MINUTE;
      await ask(ben, storyId);
      clock.now = T0 + 40 * MINUTE;
      await ask(ben, storyId);

      clock.now = T0 + HOUR - 1;
      expect((await ask(ben, storyId)).status).toBe(429);

      clock.now = T0 + HOUR;
      expect((await ask(ben, storyId)).status).toBe(200);
      expect((await ask(ben, storyId)).status).toBe(429);

      clock.now = T0 + HOUR + 20 * MINUTE;
      expect((await ask(ben, storyId)).status).toBe(200);
    });

    it("limits a refused request before the provider is called", async () => {
      const { storyId, ben } = await twoPersonStory();
      for (let n = 0; n < SUGGESTION_LIMIT; n += 1) {
        await ask(ben, storyId);
      }
      seen.length = 0;

      await ask(ben, storyId);

      expect(seen).toEqual([]);
    });

    it("lets only the limit through when requests arrive at once", async () => {
      const { storyId, ben, benId } = await twoPersonStory();
      const requests = 6;
      const gated = { env: { DB: gateLoads(testEnv.env.DB, requests) } };

      const responses = await Promise.all(
        Array.from({ length: requests }, () => ask(ben, storyId, gated)),
      );

      const statuses = responses.map((response) => response.status).toSorted((a, b) => a - b);
      expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
      expect(await requestCount(benId)).toBe(SUGGESTION_LIMIT);
      expect(seen).toHaveLength(SUGGESTION_LIMIT);
    });
  });

  describe("when the provider fails", () => {
    it("answers 503 ai_unavailable", async () => {
      const { storyId, ben } = await twoPersonStory();
      answer = () => ({ ok: false });

      const response = await ask(ben, storyId);

      expect(response.status).toBe(503);
      expect(await readError(response)).toBe("ai_unavailable");
    });

    it("does not use up quota", async () => {
      const { storyId, ben, benId } = await twoPersonStory();
      answer = () => ({ ok: false });
      for (let n = 0; n < SUGGESTION_LIMIT + 2; n += 1) {
        expect((await ask(ben, storyId)).status).toBe(503);
      }
      expect(await requestCount(benId)).toBe(0);

      answer = goodAnswer;
      for (let n = 0; n < SUGGESTION_LIMIT; n += 1) {
        expect((await ask(ben, storyId)).status).toBe(200);
      }
      expect((await ask(ben, storyId)).status).toBe(429);
    });

    it("gives back only the failed request's slot", async () => {
      const { storyId, ben, benId } = await twoPersonStory();
      await ask(ben, storyId);
      answer = () => ({ ok: false });

      await ask(ben, storyId);

      expect(await requestCount(benId)).toBe(1);
    });

    it("leaves the story unchanged", async () => {
      const { storyId, ben } = await twoPersonStory();
      const before = await readStory(ben, storyId);
      answer = () => ({ ok: false });

      await ask(ben, storyId);

      expect(await readStory(ben, storyId)).toEqual(before);
    });
  });

  describe("with the configured provider", () => {
    let storyCount = 0;
    const configured = createApp({
      now: () => clock.now,
      newStoryId: () => {
        storyCount += 1;
        return `cfg${String(storyCount).padStart(2, "0")}`;
      },
      suggestionProvider: selectSuggestionProvider,
    });

    async function holder(vars: object): Promise<{ ben: Browser; storyId: string; env: Env }> {
      clock.now = T0;
      const env = envWith(testEnv.env, vars);
      const [ana, ben] = [createBrowser(configured, env), createBrowser(configured, env)];
      const storyId = await createStory(ana);
      await joinStory(ben, storyId, "Ben");

      return { ben, storyId, env };
    }

    it("runs the Workers AI model and returns its suggestions", async () => {
      const run = vi
        .fn<RunModel>()
        .mockResolvedValue({ response: { suggestions: ["x", "y", "z"] } });
      const { ben, storyId } = await holder({ AI_PROVIDER: "workers-ai", AI: { run } });

      const response = await ask(ben, storyId);

      expect(response.status).toBe(200);
      expect(suggestionsResponseSchema.parse(await response.json()).suggestions).toEqual([
        "x",
        "y",
        "z",
      ]);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("answers 503 when Workers AI throws, and keeps the quota", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const run = vi.fn<RunModel>().mockRejectedValue(new Error("quota exceeded"));
      const { ben, storyId } = await holder({ AI_PROVIDER: "workers-ai", AI: { run } });

      const response = await ask(ben, storyId);

      expect(response.status).toBe(503);
      expect(await readError(response)).toBe("ai_unavailable");
    });

    it("fails with 500 on a bad AI_PROVIDER, before using up quota", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { ben, storyId, env } = await holder({ AI_PROVIDER: "nope" });
      const before = await totalRequests(env.DB);

      const response = await ask(ben, storyId);

      expect(response.status).toBe(500);
      expect(await readError(response)).toBe("internal_error");
      expect(await totalRequests(env.DB)).toBe(before);
    });
  });
});

async function totalRequests(db: D1Database): Promise<number> {
  const result = await db.prepare("SELECT COUNT(*) AS n FROM suggestion_requests").all();

  return z.array(z.object({ n: z.number() })).parse(result.results)[0]?.n ?? -1;
}
