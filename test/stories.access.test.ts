import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_BODY_BYTES } from "../src/worker/config";
import {
  createBrowser,
  createStory,
  createTestApp,
  joinStory,
  newDisplayName,
  readError,
  readStory,
  T0,
  type Browser,
  type Clock,
  nameInTest,
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
    await joinStory(ben, storyId);

    return { ana, ben, storyId };
  }

  describe("reading a story", () => {
    it("answers 404 for an unknown story and for text that isn't an ID", async () => {
      const browser = newBrowser();

      for (const id of ["zzzzz", "ab-12"]) {
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

    it("answers 403 to a browser with no cookie, one that isn't in the story and a forged cookie, and shows them no story text", async () => {
      const { storyId } = await twoPersonStory();
      const stranger = newBrowser();
      const outsider = newBrowser();
      await createStory(outsider, nameInTest("Outsider"));
      const forger = newBrowser();
      forger.cookies.set("andthen_bt", "0".repeat(64));

      for (const browser of [stranger, outsider, forger]) {
        const response = await browser.get(`/api/stories/${storyId}`);

        expect(response.status).toBe(403);
        expect(await readError(response.clone())).toBe("not_participant");
        expect(await response.text()).not.toContain("Once upon a time");
      }
    });
  });

  describe("joining", () => {
    it("answers 404 for an unknown story", async () => {
      const response = await newBrowser().post("/api/stories/zzzzz/participants", {
        displayName: nameInTest("Ben"),
      });

      expect(response.status).toBe(404);
    });

    it("answers 409 already_joined when the browser is already in the story", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.post(`/api/stories/${storyId}/participants`, {});

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("already_joined");
    });

    it("answers 400 invalid_display_name for a blank name", async () => {
      const { storyId } = await twoPersonStory();

      const response = await newBrowser().post(`/api/stories/${storyId}/participants`, {
        displayName: "   ",
      });

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("invalid_display_name");
    });
  });

  describe("contributing", () => {
    it("answers 403 not_participant to a non-participant", async () => {
      const { storyId } = await twoPersonStory();

      const response = await newBrowser().post(`/api/stories/${storyId}/passages`, {
        text: "Hi.",
        turnVersion: 1,
        startsParagraph: false,
      });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
    });

    it("answers 403 not_your_turn to a participant who isn't the holder", async () => {
      const { ana, storyId } = await twoPersonStory();

      const response = await ana.post(`/api/stories/${storyId}/passages`, {
        text: "Hi.",
        turnVersion: 1,
        startsParagraph: false,
      });

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_your_turn");
    });

    it("answers 409 stale_turn for an old version and writes nothing", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.post(`/api/stories/${storyId}/passages`, {
        text: "Hi.",
        turnVersion: 0,
        startsParagraph: false,
      });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("stale_turn");
      expect((await readStory(ben, storyId)).passages).toHaveLength(1);
    });

    it("answers 400 invalid_passage for a blank passage", async () => {
      const { ben, storyId } = await twoPersonStory();

      const response = await ben.post(`/api/stories/${storyId}/passages`, {
        text: "  ",
        turnVersion: 1,
        startsParagraph: false,
      });

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("invalid_passage");
    });

    it("answers 404 for an unknown story", async () => {
      const response = await newBrowser().post("/api/stories/zzzzz/passages", {
        text: "Hi.",
        turnVersion: 0,
        startsParagraph: false,
      });

      expect(response.status).toBe(404);
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
      await ben.post(`/api/stories/${storyId}/passages`, {
        text: "Hi.",
        turnVersion: 1,
        startsParagraph: false,
      });
      // Ana holds at version 2, and Ben (the last writer) is the only other person.

      const response = await ben.post(`/api/stories/${storyId}/skip`, { turnVersion: 2 });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("no_one_to_skip_to");
    });
  });

  describe("request guards", () => {
    it("answers 403 forbidden_origin to a foreign or missing Origin on every POST route", async () => {
      const { ben, storyId } = await twoPersonStory();
      const routes: [string, unknown][] = [
        ["/api/stories", { displayName: nameInTest("Zed"), opening: "Hi." }],
        [`/api/stories/${storyId}/participants`, { displayName: nameInTest("Zed") }],
        [
          `/api/stories/${storyId}/passages`,
          { text: "Hi.", turnVersion: 1, startsParagraph: false },
        ],
        [`/api/stories/${storyId}/skip`, { turnVersion: 1 }],
      ];

      for (const [path, body] of routes) {
        for (const origin of ["https://evil.example", "http://localhost:8080", null]) {
          const response = await ben.post(path, body, { origin });

          expect(response.status).toBe(403);
          expect(await readError(response)).toBe("forbidden_origin");
        }
      }
      expect((await readStory(ben, storyId)).passages).toHaveLength(1);
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
      const body = { displayName: nameInTest("Zed"), opening: "Hi." };

      const response = await newBrowser().post("/api/stories", body, { contentType: "text/plain" });

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
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

    it("answers 400 bad_request to malformed JSON and to the wrong shape", async () => {
      const { ben, storyId } = await twoPersonStory();
      const attempts: [string, unknown, string | undefined][] = [
        ["/api/stories", undefined, "{nope"],
        ["/api/stories", undefined, ""],
        ["/api/stories", { displayName: nameInTest("Zed") }, undefined],
        ["/api/stories", { displayName: 1, opening: "Hi." }, undefined],
        ["/api/stories", [], undefined],
        [`/api/stories/${storyId}/passages`, { text: "Hi.", turnVersion: 1 }, undefined],
        [
          `/api/stories/${storyId}/passages`,
          { text: "Hi.", turnVersion: 1, startsParagraph: "yes" },
          undefined,
        ],
        [
          `/api/stories/${storyId}/passages`,
          { text: "Hi.", turnVersion: "1", startsParagraph: false },
          undefined,
        ],
        [
          `/api/stories/${storyId}/passages`,
          { text: "Hi.", turnVersion: -1, startsParagraph: false },
          undefined,
        ],
        [
          `/api/stories/${storyId}/passages`,
          { text: "Hi.", turnVersion: 1.5, startsParagraph: false },
          undefined,
        ],
        [`/api/stories/${storyId}/skip`, {}, undefined],
        [`/api/stories/${storyId}/participants`, { displayName: 1 }, undefined],
      ];

      for (const [path, body, rawBody] of attempts) {
        const response = await ben.post(path, body, rawBody === undefined ? {} : { rawBody });

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe("bad_request");
      }
    });

    it("answers 413 to a body over the size cap, and accepts one exactly at it", async () => {
      const displayName = newDisplayName();
      const envelope = JSON.stringify({ displayName, opening: "Hi.", pad: "" });
      const atCap = JSON.stringify({
        displayName,
        opening: "Hi.",
        pad: "p".repeat(MAX_BODY_BYTES - envelope.length),
      });
      expect(new TextEncoder().encode(atCap)).toHaveLength(MAX_BODY_BYTES);

      const accepted = await newBrowser().post("/api/stories", undefined, { rawBody: atCap });
      const refused = await newBrowser().post("/api/stories", undefined, { rawBody: `${atCap} ` });

      expect(accepted.status).toBe(201);
      expect(refused.status).toBe(413);
      expect(await readError(refused)).toBe("payload_too_large");
    });

    it("refuses an oversize body before it validates it", async () => {
      const response = await newBrowser().post("/api/stories", {
        displayName: "x".repeat(MAX_BODY_BYTES),
        opening: "Hi.",
      });

      expect(response.status).toBe(413);
      expect(await readError(response)).toBe("payload_too_large");
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
      expect(await readError(response)).toBe("payload_too_large");
    });
  });

  describe("error and cache headers", () => {
    it("answers an unknown API path with a JSON not_found", async () => {
      const response = await newBrowser().get("/api/nope");

      expect(response.status).toBe(404);
      expect(await readError(response)).toBe("not_found");
    });

    it("sends Cache-Control: no-store on reads, writes and errors", async () => {
      const { ana, ben, storyId } = await twoPersonStory();
      const responses = [
        await ana.get(`/api/stories/${storyId}`),
        await newBrowser().get(`/api/stories/${storyId}`),
        await newBrowser().post(`/api/stories/${storyId}/participants`, {
          displayName: newDisplayName(),
        }),
        await newBrowser().post("/api/stories", { displayName: nameInTest("Zed"), opening: "Hi." }),
        await ben.post(`/api/stories/${storyId}/passages`, {
          text: "Hi.",
          turnVersion: 1,
          startsParagraph: false,
        }),
        await ben.post(`/api/stories/${storyId}/skip`, { turnVersion: 9 }),
        await newBrowser().get("/api/nope"),
        await newBrowser().post("/api/stories", {}, { origin: null }),
      ];

      expect(responses.map((response) => response.headers.get("Cache-Control"))).toEqual(
        responses.map(() => "no-store"),
      );
    });

    it("still sets the cookie when a join is rejected, and that cookie then works", async () => {
      const { ana, ben, storyId } = await twoPersonStory();
      const cat = newBrowser();

      const rejected = await cat.post(`/api/stories/${storyId}/participants`, {
        displayName: ana.displayName,
      });
      const token = cat.cookies.get("andthen_bt");
      await joinStory(cat, storyId);

      expect(rejected.status).toBe(409);
      expect(rejected.headers.get("Set-Cookie")).toMatch(/^andthen_bt=/);
      expect(cat.cookies.get("andthen_bt")).toBe(token);
      expect((await readStory(ana, storyId)).participants.map((p) => p.displayName)).toEqual([
        ana.displayName,
        ben.displayName,
        cat.displayName,
      ]);
    });
  });

  describe("creating", () => {
    it("answers 400 for an invalid name or opening, and checks the name first", async () => {
      const cases: [string | undefined, string, string][] = [
        ["", "Hi.", "invalid_display_name"],
        [nameInTest("Ana"), " ", "invalid_passage"],
        ["", "", "invalid_display_name"],
      ];

      for (const [displayName, opening, code] of cases) {
        const response = await newBrowser().post("/api/stories", { displayName, opening });

        expect(response.status).toBe(400);
        expect(await readError(response)).toBe(code);
      }
    });

    it("gives a user one name in every story: later stories send none, a name is refused", async () => {
      const { ana, storyId } = await twoPersonStory();
      const second = await createStory(ana);
      const other = await createStory(newBrowser(), nameInTest("Zoe"));

      const view = await readStory(ana, second);
      const refusals = [
        await ana.post("/api/stories", { displayName: nameInTest("Anna"), opening: "Hi." }),
        await ana.post(`/api/stories/${other}/participants`, { displayName: nameInTest("Anna") }),
      ];

      expect(view.passages.map((p) => p.authorName)).toEqual([ana.displayName]);
      expect((await readStory(ana, storyId)).passages[0]?.authorName).toBe(ana.displayName);
      expect(refusals.map((response) => response.status)).toEqual([400, 400]);
      expect(await Promise.all(refusals.map(readError))).toEqual(["bad_request", "bad_request"]);
    });

    it("answers 409 name_taken to a name held by a user in another story", async () => {
      const { ana } = await twoPersonStory();
      const displayName = (ana.displayName ?? "").toUpperCase();
      const elsewhere = await createStory(newBrowser());

      const created = await newBrowser().post("/api/stories", { displayName, opening: "Hi." });
      const joined = await newBrowser().post(`/api/stories/${elsewhere}/participants`, {
        displayName,
      });

      expect([created.status, joined.status]).toEqual([409, 409]);
      expect([await readError(created), await readError(joined)]).toEqual([
        "name_taken",
        "name_taken",
      ]);
    });

    it("answers 404 for an unknown route under a valid story ID", async () => {
      const response = await newBrowser().get("/api/stories/zzzzz/nope");

      expect(response.status).toBe(404);
    });
  });
});
