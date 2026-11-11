import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { suggestionsResponseSchema } from "../src/shared/api";
import { createApp } from "../src/worker/app";
import { SUGGESTION_LIMIT, SUGGESTION_WINDOW_MS } from "../src/worker/config";
import { selectSessionVerifier } from "../src/worker/sessionToken";
import type { SuggestionProvider, SuggestionResult } from "../src/worker/suggestions/provider";
import { selectSuggestionProvider } from "../src/worker/suggestions/select";
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
import { createFakePushSender } from "./support/fakePushSender";
import { gateLoads } from "./support/gatedDb";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const HOUR = SUGGESTION_WINDOW_MS;
const MINUTE = 60 * 1000;

const GOOD: SuggestionResult = { ok: true, suggestions: ["One.", "Two.", "Three."] };

// A provider the test controls: what it answers, and what story text it was shown.
const goodAnswer = (): SuggestionResult => GOOD;
const noGate = (): Promise<unknown> => Promise.resolve();
const MODEL_ERROR: SuggestionResult = { ok: false, failure: "model_error" };
const UNUSABLE: SuggestionResult = { ok: false, failure: "unusable_output" };

function ask(browser: Browser, storyId: string, options?: Parameters<Browser["post"]>[2]) {
  return browser.post(`/api/stories/${storyId}/suggestions`, undefined, options);
}

// The Env the test bed built, plus extra variables and bindings.
function envWith(base: Env, vars: object): Env {
  // oxlint-disable-next-line typescript/no-unsafe-return -- a partial Env is the point
  return Object.assign(Object.create(null), base, vars);
}

function scriptedProvider(
  answer: () => SuggestionResult,
  gate: () => Promise<unknown>,
): { provider: SuggestionProvider; seen: string[] } {
  const seen: string[] = [];

  return {
    seen,
    provider: {
      suggest: async (storyText) => {
        seen.push(storyText);
        await gate();
        return answer();
      },
    },
  };
}

describe("POST /api/stories/:storyId/suggestions", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  let answer = goodAnswer;
  let gate = noGate;
  const { provider, seen } = scriptedProvider(
    () => answer(),
    () => gate(),
  );
  const app = createTestApp(clock, undefined, provider);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  afterEach(() => {
    vi.useRealTimers();
    answer = goodAnswer;
    gate = noGate;
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
    const storyId = await createStory(ana, nameInTest("Ana"), "Opening line.");
    const benId = await joinStory(ben, storyId, nameInTest("Ben"));

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
    it("returns three suggestions, uncached, with or without a body", async () => {
      const { storyId, ben } = await twoPersonStory();

      const response = await ask(ben, storyId);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(suggestionsResponseSchema.parse(await response.json()).suggestions).toEqual([
        "One.",
        "Two.",
        "Three.",
      ]);

      const bodyless = await ask(ben, storyId, { rawBody: "" });

      expect(bodyless.status).toBe(200);
    });

    it("shows the provider the story as paragraphs, passages in order", async () => {
      const { storyId, ana, ben } = await twoPersonStory();
      expect((await readStory(ben, storyId)).turn.version).toBe(1);
      await ben.post(`/api/stories/${storyId}/passages`, {
        text: "Ben adds this.",
        turnVersion: 1,
        startsParagraph: false,
      });

      const { turn } = await readStory(ana, storyId);
      await ana.post(`/api/stories/${storyId}/passages`, {
        text: "Ana starts a new one.",
        turnVersion: turn.version,
        startsParagraph: true,
      });

      await ask(ben, storyId);

      expect(seen).toEqual(["Opening line. Ben adds this.\n\nAna starts a new one."]);
    });

    it("changes nothing in the story, does not touch the turn and tells no room, even when the model fails", async () => {
      const { storyId, ben } = await twoPersonStory();
      const before = await readStory(ben, storyId);
      const backgroundWork = ben.backgroundWork.length;

      await ask(ben, storyId);
      await ask(ben, storyId);
      expect(await readStory(ben, storyId)).toEqual(before);

      answer = () => MODEL_ERROR;
      await ask(ben, storyId);

      expect(await readStory(ben, storyId)).toEqual(before);
      expect(ben.backgroundWork).toHaveLength(backgroundWork);
    });
  });

  describe("who may ask", () => {
    it("refuses a participant who does not hold the turn, following the resolved turn", async () => {
      const { storyId, ana, ben } = await twoPersonStory();

      const response = await ask(ana, storyId);

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_your_turn");
      expect(seen).toEqual([]);

      // Ben's turn runs out and passes to Cat, the next in turn order (Ana wrote last).
      const cat = newBrowser();
      await joinStory(cat, storyId, nameInTest("Cat"));
      clock.now = T0 + 24 * HOUR;
      const staleHolder = await ask(ben, storyId);
      const newHolder = await ask(cat, storyId);

      expect(staleHolder.status).toBe(403);
      expect(await readError(staleHolder)).toBe("not_your_turn");
      expect(newHolder.status).toBe(200);
    });

    it("refuses a browser that is not in the story", async () => {
      const { storyId, ana } = await twoPersonStory();
      const stranger = newBrowser();
      await createStory(stranger, nameInTest("Zed"));

      const response = await ask(stranger, storyId);

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
      expect(ana.cookies.size).toBe(1);
    });

    it("answers 404 for an unknown story", async () => {
      const browser = newBrowser();

      const response = await ask(browser, "zzzzz");

      expect(response.status).toBe(404);
      expect(await readError(response)).toBe("not_found");
    });

    it("applies the Origin and Content-Type guards", async () => {
      const { storyId, ben } = await twoPersonStory();

      const wrongOrigin = await ask(ben, storyId, { origin: "https://evil.example" });
      const wrongType = await ask(ben, storyId, { contentType: "text/plain" });

      expect(wrongOrigin.status).toBe(403);
      expect(await readError(wrongOrigin)).toBe("forbidden_origin");
      expect(wrongType.status).toBe(400);
      expect(await readError(wrongType)).toBe("bad_request");
      expect(seen).toEqual([]);
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

    it("counts each participant on their own, across stories", async () => {
      const first = await twoPersonStory();
      for (let n = 0; n < SUGGESTION_LIMIT; n += 1) {
        await ask(first.ben, first.storyId);
      }
      await first.ben.post(`/api/stories/${first.storyId}/passages`, {
        text: "Mine.",
        turnVersion: 1,
        startsParagraph: false,
      });
      expect((await ask(first.ana, first.storyId)).status).toBe(200);

      const second = await createStory(first.ana);
      await joinStory(first.ben, second);

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

  describe("when the model errors", () => {
    it("answers 503 ai_unavailable, and gives back only the failed request's slot", async () => {
      const { storyId, ben, benId } = await twoPersonStory();
      answer = () => MODEL_ERROR;
      const first = await ask(ben, storyId);
      expect(first.status).toBe(503);
      expect(await readError(first)).toBe("ai_unavailable");
      for (let n = 1; n < SUGGESTION_LIMIT + 2; n += 1) {
        expect((await ask(ben, storyId)).status).toBe(503);
      }
      expect(await requestCount(benId)).toBe(0);

      answer = goodAnswer;
      expect((await ask(ben, storyId)).status).toBe(200);
      answer = () => MODEL_ERROR;
      await ask(ben, storyId);
      expect(await requestCount(benId)).toBe(1);

      answer = goodAnswer;
      for (let n = 1; n < SUGGESTION_LIMIT; n += 1) {
        expect((await ask(ben, storyId)).status).toBe(200);
      }
      expect((await ask(ben, storyId)).status).toBe(429);
    });

    it("holds the slot while the call runs, so an overlapping request can get 429 early", async () => {
      const { storyId, ben, benId } = await twoPersonStory();
      await ask(ben, storyId);
      await ask(ben, storyId);
      const release = Promise.withResolvers<undefined>();
      gate = () => release.promise;
      answer = () => MODEL_ERROR;

      const failing = ask(ben, storyId);
      await vi.waitFor(() => {
        expect(seen).toHaveLength(3);
      });
      const overlapping = await ask(ben, storyId);
      release.resolve(undefined);
      const failed = await failing;

      expect(overlapping.status).toBe(429);
      expect(failed.status).toBe(503);
      expect(await requestCount(benId)).toBe(2);
      gate = noGate;
      answer = goodAnswer;
      expect((await ask(ben, storyId)).status).toBe(200);
    });

    it("still answers 503 when giving the slot back fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { storyId, ben, benId } = await twoPersonStory();
      answer = () => MODEL_ERROR;
      const brokenRelease = {
        prepare: (query: string) => {
          if (query.startsWith("DELETE FROM suggestion_requests")) {
            throw new Error("D1 unavailable");
          }
          return testEnv.env.DB.prepare(query);
        },
        batch: testEnv.env.DB.batch.bind(testEnv.env.DB),
      };

      const response = await ask(ben, storyId, { env: { DB: brokenRelease } });

      expect(response.status).toBe(503);
      expect(await readError(response)).toBe("ai_unavailable");
      expect(await requestCount(benId)).toBe(1);
    });
  });

  describe("when the model's output is unusable", () => {
    it("answers 503 and keeps the slot, because the calls were made", async () => {
      const { storyId, ben, benId } = await twoPersonStory();
      answer = () => UNUSABLE;

      const response = await ask(ben, storyId);

      expect(response.status).toBe(503);
      expect(await readError(response)).toBe("ai_unavailable");
      expect(await requestCount(benId)).toBe(1);
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
      pushSender: () => createFakePushSender(),
      sessionVerifier: selectSessionVerifier,
    });

    async function holder(vars: object): Promise<{ ben: Browser; storyId: string; env: Env }> {
      clock.now = T0;
      const env = envWith(testEnv.env, vars);
      const [ana, ben] = [createBrowser(configured, env), createBrowser(configured, env)];
      const storyId = await createStory(ana);
      await joinStory(ben, storyId, nameInTest("Ben"));

      return { ben, storyId, env };
    }

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
