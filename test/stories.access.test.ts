import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_BODY_BYTES } from "../src/worker/config";
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
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("story access", () => {
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

  // Ana created the story and Ben joined: Ben holds the turn at version 1.
  async function twoPersonStory(): Promise<{ ana: Browser; ben: Browser; storyId: string }> {
    clock.now = T0;
    const [ana, ben] = [newBrowser(), newBrowser()];
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");

    return { ana, ben, storyId };
  }

  describe("reading a story", () => {
    it("answers 404 for an unknown story and for text that isn't an ID", async () => {
      const browser = newBrowser();

      for (const id of ["zzzzz", "abc", "abcdef", "ab-12"]) {
        const response = await browser.get(`/api/stories/${id}`);

        expect(response.status).toBe(404);
        expect(await readError(response)).toBe("not_found");
      }
    });

    it("rejects an ID that can't be a story ID without touching the database", async () => {
      const response = await app.request(
        "http://localhost/api/stories/ab-12",
        {},
        {
          DB: {
            prepare: () => {
              throw new Error("the database was touched");
            },
          },
        },
      );

      expect(response.status).toBe(404);
    });

    it("answers 403 to a browser with no cookie and to one that isn't in the story", async () => {
      const { storyId } = await twoPersonStory();
      const stranger = newBrowser();
      const outsider = newBrowser();
      await createStory(outsider);

      for (const browser of [stranger, outsider]) {
        const response = await browser.get(`/api/stories/${storyId}`);

        expect(response.status).toBe(403);
        expect(await readError(response)).toBe("not_participant");
      }
    });

    it("never shows story text to a non-participant", async () => {
      const { storyId } = await twoPersonStory();

      const response = await newBrowser().get(`/api/stories/${storyId}`);

      expect(await response.text()).not.toContain("Once upon a time");
    });

    it("answers 403 to a cookie that is not a participant's token", async () => {
      const { storyId } = await twoPersonStory();
      const forger = newBrowser();
      forger.cookies.set("andthen_bt", "0".repeat(64));

      const response = await forger.get(`/api/stories/${storyId}`);

      expect(response.status).toBe(403);
    });
  });

  describe("joining", () => {
    it("answers 404 for an unknown story", async () => {
      const response = await newBrowser().post("/api/stories/zzzzz/participants", {
        displayName: "Ben",
      });

      expect(response.status).toBe(404);
    });

    it("answers 409 already_joined when the browser is already in the story", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.post(`/api/stories/${storyId}/participants`, {
        displayName: "Benny",
      });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("already_joined");
    });

    it("answers 409 name_taken for a name in use, whatever its case", async () => {
      const { storyId } = await twoPersonStory();

      for (const displayName of ["Ana", "ANA", " ana "]) {
        const response = await newBrowser().post(`/api/stories/${storyId}/participants`, {
          displayName,
        });

        expect(response.status).toBe(409);
        expect(await readError(response)).toBe("name_taken");
      }
    });

    it("answers 400 invalid_display_name for an empty or too long name", async () => {
      const { storyId } = await twoPersonStory();

      for (const displayName of ["   ", "x".repeat(41)]) {
        const response = await newBrowser().post(`/api/stories/${storyId}/participants`, {
          displayName,
        });

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe("invalid_display_name");
      }
    });

    it("counts a name in graphemes: 40 family emoji are allowed", async () => {
      const { storyId } = await twoPersonStory();

      const response = await newBrowser().post(`/api/stories/${storyId}/participants`, {
        displayName: "👩‍👩‍👧‍👦".repeat(40),
      });

      expect(response.status).toBe(201);
    });
  });

  describe("contributing", () => {
    it("answers 403 not_participant to a non-participant", async () => {
      const { storyId } = await twoPersonStory();

      const response = await newBrowser().post(`/api/stories/${storyId}/contributions`, {
        text: "Hi.",
        turnVersion: 1,
      });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
    });

    it("answers 403 not_your_turn to a participant who isn't the holder", async () => {
      const { ana, storyId } = await twoPersonStory();

      const response = await ana.post(`/api/stories/${storyId}/contributions`, {
        text: "Hi.",
        turnVersion: 1,
      });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_your_turn");
    });

    it("answers 409 stale_turn for an old version and writes nothing", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.post(`/api/stories/${storyId}/contributions`, {
        text: "Hi.",
        turnVersion: 0,
      });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("stale_turn");
      expect((await readStory(ben, storyId)).contributions).toHaveLength(1);
    });

    it("answers 400 invalid_passage for an empty or too long passage", async () => {
      const { ben, storyId } = await twoPersonStory();

      for (const text of ["  ", "x".repeat(281)]) {
        const response = await ben.post(`/api/stories/${storyId}/contributions`, {
          text,
          turnVersion: 1,
        });

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe("invalid_passage");
      }
    });

    it("accepts a passage of exactly 280 graphemes", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.post(`/api/stories/${storyId}/contributions`, {
        text: "x".repeat(280),
        turnVersion: 1,
      });

      expect(response.status).toBe(204);
    });

    it("answers 404 for an unknown story", async () => {
      const response = await newBrowser().post("/api/stories/zzzzz/contributions", {
        text: "Hi.",
        turnVersion: 0,
      });

      expect(response.status).toBe(404);
    });

    it("answers 409 stale_turn to a holder whose turn has expired", async () => {
      const { ben, storyId } = await twoPersonStory();

      clock.now = T0 + 24 * 60 * 60 * 1000;
      const response = await ben.post(`/api/stories/${storyId}/contributions`, {
        text: "Late.",
        turnVersion: 1,
      });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("stale_turn");
    });
  });

  describe("skipping", () => {
    it("answers 403 not_participant to a non-participant", async () => {
      const { storyId } = await twoPersonStory();

      const response = await newBrowser().post(`/api/stories/${storyId}/skip`, { turnVersion: 1 });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
    });

    it("answers 403 cannot_skip_self to the holder", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.post(`/api/stories/${storyId}/skip`, { turnVersion: 1 });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("cannot_skip_self");
    });

    it("answers 409 stale_turn for an old version", async () => {
      const { ana, storyId } = await twoPersonStory();

      const response = await ana.post(`/api/stories/${storyId}/skip`, { turnVersion: 0 });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("stale_turn");
    });

    it("answers 409 no_one_to_skip_to when the skip would come straight back", async () => {
      const { ben, storyId } = await twoPersonStory();
      await ben.post(`/api/stories/${storyId}/contributions`, { text: "Hi.", turnVersion: 1 });
      // Ana holds at version 2, and Ben (the last writer) is the only other person.

      const response = await ben.post(`/api/stories/${storyId}/skip`, { turnVersion: 2 });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("no_one_to_skip_to");
    });

    it("answers 409 stale_turn while the story waits for a joiner", async () => {
      clock.now = T0;
      const ana = newBrowser();
      const storyId = await createStory(ana);

      const response = await ana.post(`/api/stories/${storyId}/skip`, { turnVersion: 0 });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("stale_turn");
    });
  });

  describe("request guards", () => {
    it("answers 403 forbidden_origin to a foreign or missing Origin on every POST route", async () => {
      const { ben, storyId } = await twoPersonStory();
      const routes: [string, unknown][] = [
        ["/api/stories", { displayName: "Zed", opening: "Hi." }],
        [`/api/stories/${storyId}/participants`, { displayName: "Zed" }],
        [`/api/stories/${storyId}/contributions`, { text: "Hi.", turnVersion: 1 }],
        [`/api/stories/${storyId}/skip`, { turnVersion: 1 }],
      ];

      for (const [path, body] of routes) {
        for (const origin of ["https://evil.example", "http://localhost:8080", null]) {
          const response = await ben.post(path, body, { origin });

          expect(response.status).toBe(403);
          expect(await readError(response)).toBe("forbidden_origin");
        }
      }
      expect((await readStory(ben, storyId)).contributions).toHaveLength(1);
    });

    it("checks the Origin before it reads the body", async () => {
      const response = await newBrowser().post("/api/stories", undefined, {
        origin: "https://evil.example",
        rawBody: "not json",
      });

      expect(response.status).toBe(403);
    });

    it("lets a GET through without an Origin", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.get(`/api/stories/${storyId}`);

      expect(response.status).toBe(200);
    });

    it("answers 400 bad_request to a POST that isn't application/json", async () => {
      const body = { displayName: "Zed", opening: "Hi." };

      for (const contentType of [
        null,
        "text/plain",
        "application/x-www-form-urlencoded",
        "json",
        "text/application/json",
      ]) {
        const response = await newBrowser().post("/api/stories", body, { contentType });

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe("bad_request");
      }
    });

    it("treats a Content-Type with spaces around the semicolon as JSON", async () => {
      const response = await newBrowser().post(
        "/api/stories",
        { displayName: "Zed", opening: "Hi." },
        { contentType: "application/json ; charset=utf-8" },
      );

      expect(response.status).toBe(201);
    });

    it("guards only mutating methods: HEAD and OPTIONS pass without an Origin", async () => {
      for (const method of ["HEAD", "OPTIONS"]) {
        const response = await app.request("http://localhost/api/health", { method }, testEnv.env);

        expect(response.status).not.toBe(403);
      }
    });

    it("answers 403 to other mutating methods without an Origin", async () => {
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const response = await app.request("http://localhost/api/health", { method }, testEnv.env);

        expect(response.status).toBe(403);
      }
    });

    it("accepts application/json with parameters and any case", async () => {
      const body = { displayName: "Zed", opening: "Hi." };

      for (const contentType of ["application/json; charset=utf-8", "Application/JSON"]) {
        const response = await newBrowser().post("/api/stories", body, { contentType });

        expect(response.status).toBe(201);
      }
    });

    it("answers 400 bad_request to malformed JSON and to the wrong shape", async () => {
      const { ben, storyId } = await twoPersonStory();
      const attempts: [string, unknown, string | undefined][] = [
        ["/api/stories", undefined, "{nope"],
        ["/api/stories", undefined, ""],
        ["/api/stories", { displayName: "Zed" }, undefined],
        ["/api/stories", { displayName: 1, opening: "Hi." }, undefined],
        ["/api/stories", [], undefined],
        [`/api/stories/${storyId}/contributions`, { text: "Hi.", turnVersion: "1" }, undefined],
        [`/api/stories/${storyId}/contributions`, { text: "Hi.", turnVersion: -1 }, undefined],
        [`/api/stories/${storyId}/contributions`, { text: "Hi.", turnVersion: 1.5 }, undefined],
        [`/api/stories/${storyId}/skip`, {}, undefined],
        [`/api/stories/${storyId}/participants`, {}, undefined],
      ];

      for (const [path, body, rawBody] of attempts) {
        const response = await ben.post(path, body, rawBody === undefined ? {} : { rawBody });

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe("bad_request");
      }
    });

    it("answers 413 to a body over the size cap, and accepts one exactly at it", async () => {
      const envelope = JSON.stringify({ displayName: "Zed", opening: "Hi.", pad: "" });
      const atCap = JSON.stringify({
        displayName: "Zed",
        opening: "Hi.",
        pad: "p".repeat(MAX_BODY_BYTES - envelope.length),
      });
      expect(new TextEncoder().encode(atCap)).toHaveLength(MAX_BODY_BYTES);

      const accepted = await newBrowser().post("/api/stories", undefined, { rawBody: atCap });
      const refused = await newBrowser().post("/api/stories", undefined, { rawBody: `${atCap} ` });

      expect(accepted.status).toBe(201);
      expect(refused.status).toBe(413);
      expect(await readError(refused)).toBe("bad_request");
    });

    it("refuses an oversize body before it validates it", async () => {
      const response = await newBrowser().post("/api/stories", {
        displayName: "x".repeat(MAX_BODY_BYTES),
        opening: "Hi.",
      });

      expect(response.status).toBe(413);
    });

    it("refuses an oversize body using its Content-Length, without reading it", async () => {
      const response = await app.request(
        "http://localhost/api/stories",
        {
          method: "POST",
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
            "Content-Length": String(MAX_BODY_BYTES + 1),
          },
          body: "{}",
        },
        testEnv.env,
      );

      expect(response.status).toBe(413);
    });
  });

  describe("creating", () => {
    it("answers 400 for an invalid name or opening, and checks the name first", async () => {
      const cases: [string, string, string][] = [
        ["", "Hi.", "invalid_display_name"],
        ["x".repeat(41), "Hi.", "invalid_display_name"],
        ["Ana", " ", "invalid_passage"],
        ["Ana", "x".repeat(281), "invalid_passage"],
        ["", "", "invalid_display_name"],
      ];

      for (const [displayName, opening, code] of cases) {
        const response = await newBrowser().post("/api/stories", { displayName, opening });

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe(code);
      }
    });

    it("answers 404 for an unknown route under a valid story ID", async () => {
      const response = await newBrowser().get("/api/stories/zzzzz/nope");

      expect(response.status).toBe(404);
    });
  });
});
