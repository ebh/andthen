import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TURN_WINDOW_MS } from "../src/shared/validation";
import { app as defaultApp } from "../src/worker/app";
import {
  createBrowser,
  createStory,
  createTestApp,
  joinStory,
  readError,
  readStory,
  T0,
  type Clock,
} from "./support/browser";
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("story journeys", () => {
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

  it("creates a story that waits for a joiner", async () => {
    clock.now = T0;
    const ana = newBrowser();

    const storyId = await createStory(ana, "  Ana  ", "  Once upon a time.  ");

    expect(storyId).toMatch(/^[a-z0-9]{5}$/);
    const view = await readStory(ana, storyId);
    const [opening] = view.contributions;
    expect(view.contributions).toHaveLength(1);
    expect(opening).toEqual({
      id: opening?.id,
      authorId: view.me,
      authorName: "Ana",
      text: "Once upon a time.",
      createdAt: T0,
    });
    expect(opening?.id).not.toBe("");
    expect(view.participants).toEqual([{ id: view.me, displayName: "Ana" }]);
    expect(view.turn).toEqual({ holderId: null, endsAt: null, version: 0 });
  });

  it("gives the turn to the first joiner and sends it back after they write", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const storyId = await createStory(ana);

    const benId = await joinStory(ben, storyId, "Ben");

    const joined = await readStory(ben, storyId);
    expect(joined.me).toBe(benId);
    expect(joined.participants.map((p) => p.displayName)).toEqual(["Ana", "Ben"]);
    expect(joined.turn).toEqual({ holderId: benId, endsAt: T0 + TURN_WINDOW_MS, version: 1 });

    clock.now = T0 + 1000;
    const written = await ben.post(`/api/stories/${storyId}/contributions`, {
      text: " And then Ben wrote. ",
      turnVersion: 1,
    });

    expect(written.status).toBe(204);
    const after = await readStory(ana, storyId);
    expect(after.contributions.map((c) => [c.authorName, c.text, c.createdAt])).toEqual([
      ["Ana", "Once upon a time.", T0],
      ["Ben", "And then Ben wrote.", T0 + 1000],
    ]);
    expect(after.turn).toEqual({
      holderId: after.participants[0]?.id,
      endsAt: T0 + 1000 + TURN_WINDOW_MS,
      version: 2,
    });
  });

  it("lets a third person skip the holder, and the turn passes over the last writer", async () => {
    clock.now = T0;
    const [ana, ben, cat] = [newBrowser(), newBrowser(), newBrowser()];
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");
    await ben.post(`/api/stories/${storyId}/contributions`, {
      text: "Ben's turn.",
      turnVersion: 1,
    });
    const catId = await joinStory(cat, storyId, "Cat");
    expect((await readStory(cat, storyId)).turn.version).toBe(3);

    clock.now = T0 + 5000;
    const skipped = await cat.post(`/api/stories/${storyId}/skip`, { turnVersion: 3 });

    expect(skipped.status).toBe(204);
    const view = await readStory(cat, storyId);
    expect(view.turn).toEqual({ holderId: catId, endsAt: T0 + 5000 + TURN_WINDOW_MS, version: 4 });
  });

  it("shows an expired turn on the next holder without writing anything", async () => {
    clock.now = T0;
    const [ana, ben, cat] = [newBrowser(), newBrowser(), newBrowser()];
    const storyId = await createStory(ana);
    const benId = await joinStory(ben, storyId, "Ben");
    const catId = await joinStory(cat, storyId, "Cat");
    expect((await readStory(ana, storyId)).turn.holderId).toBe(benId);
    const before = await testEnv.env.DB.prepare("SELECT * FROM stories WHERE id = ?")
      .bind(storyId)
      .first();

    clock.now = T0 + TURN_WINDOW_MS - 1;
    expect((await readStory(ana, storyId)).turn).toEqual({
      holderId: benId,
      endsAt: T0 + TURN_WINDOW_MS,
      version: 2,
    });

    clock.now = T0 + TURN_WINDOW_MS;
    expect((await readStory(ana, storyId)).turn).toEqual({
      holderId: catId,
      endsAt: T0 + 2 * TURN_WINDOW_MS,
      version: 3,
    });
    const after = await testEnv.env.DB.prepare("SELECT * FROM stories WHERE id = ?")
      .bind(storyId)
      .first();
    expect(after).toEqual(before);
  });

  it("saves the resolved expiry when the new holder writes", async () => {
    clock.now = T0;
    const [ana, ben, cat] = [newBrowser(), newBrowser(), newBrowser()];
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");
    await joinStory(cat, storyId, "Cat");

    clock.now = T0 + TURN_WINDOW_MS + 5;
    const stale = await ben.post(`/api/stories/${storyId}/contributions`, {
      text: "Too late.",
      turnVersion: 2,
    });
    const late = await cat.post(`/api/stories/${storyId}/contributions`, {
      text: "Cat takes over.",
      turnVersion: 3,
    });

    expect(stale.status).toBe(409);
    expect(await readError(stale)).toBe("stale_turn");
    expect(late.status).toBe(204);
    const row = await testEnv.env.DB.prepare(
      "SELECT current_position AS p, turn_started_at AS t, turn_version AS v, last_contributor_position AS l FROM stories WHERE id = ?",
    )
      .bind(storyId)
      .first();
    // Cat (position 2) wrote at version 3; Ana (0) is next, not Ben (1, skipped by expiry)
    expect(row).toEqual({ p: 0, t: T0 + TURN_WINDOW_MS + 5, v: 4, l: 2 });
  });

  // Ana wrote first, Ben holds from T0 at version 2, Cat is third in the rotation.
  async function threeAtT0() {
    clock.now = T0;
    const [ana, ben, cat] = [newBrowser(), newBrowser(), newBrowser()];
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");
    await joinStory(cat, storyId, "Cat");

    return { ana, ben, cat, storyId };
  }

  const turnRow = (storyId: string) =>
    testEnv.env.DB.prepare(
      "SELECT current_position AS p, turn_started_at AS t, turn_version AS v, last_contributor_position AS l FROM stories WHERE id = ?",
    )
      .bind(storyId)
      .first();

  it("saves a skip over one expired window, from the version it loaded", async () => {
    const { ana, storyId } = await threeAtT0();

    clock.now = T0 + TURN_WINDOW_MS + 5;
    // One window passed: Cat holds at version 3. Skipping her passes over Ana, the last writer.
    const response = await ana.post(`/api/stories/${storyId}/skip`, { turnVersion: 3 });

    expect(response.status).toBe(204);
    expect(await turnRow(storyId)).toEqual({ p: 1, t: clock.now, v: 4, l: 0 });
  });

  it("saves a skip over two expired windows, from the version it loaded", async () => {
    const { cat, storyId } = await threeAtT0();

    clock.now = T0 + 2 * TURN_WINDOW_MS + 5;
    // Two windows passed: Ben holds again at version 4. Cat skips him and takes the turn.
    const response = await cat.post(`/api/stories/${storyId}/skip`, { turnVersion: 4 });

    expect(response.status).toBe(204);
    expect(await turnRow(storyId)).toEqual({ p: 2, t: clock.now, v: 5, l: 0 });
  });

  it("saves a join over one expired window, from the version it loaded", async () => {
    const { storyId } = await threeAtT0();

    clock.now = T0 + TURN_WINDOW_MS + 5;
    const response = await newBrowser().post(`/api/stories/${storyId}/participants`, {
      displayName: "Dee",
    });

    expect(response.status).toBe(201);
    // Cat holds from the end of the first window; the join adds one to version 3.
    expect(await turnRow(storyId)).toEqual({ p: 2, t: T0 + TURN_WINDOW_MS, v: 4, l: 0 });
  });

  it("saves a join over two expired windows, from the version it loaded", async () => {
    const { storyId } = await threeAtT0();

    clock.now = T0 + 2 * TURN_WINDOW_MS + 5;
    const response = await newBrowser().post(`/api/stories/${storyId}/participants`, {
      displayName: "Dee",
    });

    expect(response.status).toBe(201);
    expect(await turnRow(storyId)).toEqual({ p: 1, t: T0 + 2 * TURN_WINDOW_MS, v: 5, l: 0 });
    const count = await testEnv.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM participants WHERE story_id = ?",
    )
      .bind(storyId)
      .first();
    expect(count).toEqual({ n: 4 });
  });

  it("looks a story up whatever the case of the ID in the URL", async () => {
    const ana = newBrowser();
    const storyId = await createStory(ana);

    const response = await ana.get(`/api/stories/${storyId.toUpperCase()}`);

    expect(response.status).toBe(200);
  });

  it("lets one browser start several stories under one cookie", async () => {
    const ana = newBrowser();
    await createStory(ana);
    const token = ana.cookies.get("andthen_bt");

    const second = await createStory(ana, "Ana again", "Another one.");

    expect(ana.cookies.get("andthen_bt")).toBe(token);
    expect((await readStory(ana, second)).participants).toHaveLength(1);
  });
});

describe("story IDs", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("retries with a new ID when one is taken", async () => {
    const ids = ["taken", "taken", "fresh"];
    const app = createTestApp({ now: T0 }, () => ids.shift() ?? "never");
    const first = await createStory(createBrowser(app, testEnv.env));
    const second = createBrowser(app, testEnv.env);

    const storyId = await createStory(second);

    expect(first).toBe("taken");
    expect(storyId).toBe("fresh");
    expect((await readStory(second, "fresh")).participants).toHaveLength(1);
    expect(ids).toEqual([]);
  });

  it("fails with a 500 and writes nothing when every ID is taken", async () => {
    const app = createTestApp({ now: T0 }, () => "taken");
    const response = await createBrowser(app, testEnv.env).post("/api/stories", {
      displayName: "Zed",
      opening: "Hi.",
    });

    expect(response.status).toBe(500);
    const count = await testEnv.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM participants WHERE display_name = 'Zed'",
    ).first();
    expect(count).toEqual({ n: 0 });
  });

  it("fails with a 500, without retrying, on any other write error", async () => {
    let asked = 0;
    const app = createTestApp({ now: T0 }, () => {
      asked += 1;
      return "toolong";
    });

    const response = await createBrowser(app, testEnv.env).post("/api/stories", {
      displayName: "Zed",
      opening: "Hi.",
    });

    expect(response.status).toBe(500);
    expect(await readError(response)).toBe("internal_error");
    expect(asked).toBe(1);
  });
});

describe("cookies", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("sends a plain, non-Secure cookie on http://localhost", async () => {
    const browser = createBrowser(createTestApp({ now: T0 }), testEnv.env);

    const response = await browser.post("/api/stories", { displayName: "Ana", opening: "Hi." });

    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^andthen_bt=[0-9a-f]{64};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).not.toContain("Secure");
  });

  it("sends a __Host- Secure cookie everywhere else", async () => {
    const origin = "https://app.andthen.page";
    const browser = createBrowser(createTestApp({ now: T0 }), testEnv.env, origin);

    const response = await browser.post("/api/stories", { displayName: "Ana", opening: "Hi." });

    const cookie = response.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^__Host-andthen_bt=[0-9a-f]{64};/);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=31536000");
  });

  it("treats http on another host as needing the __Host- cookie", async () => {
    const browser = createBrowser(createTestApp({ now: T0 }), testEnv.env, "http://example.test");

    const response = await browser.post("/api/stories", { displayName: "Ana", opening: "Hi." });

    expect(response.headers.get("Set-Cookie")).toMatch(/^__Host-andthen_bt=/);
  });

  it("treats https on localhost as needing the __Host- cookie", async () => {
    const browser = createBrowser(createTestApp({ now: T0 }), testEnv.env, "https://localhost");

    const response = await browser.post("/api/stories", { displayName: "Ana", opening: "Hi." });

    expect(response.headers.get("Set-Cookie")).toMatch(/^__Host-andthen_bt=/);
  });

  it("stores only the SHA-256 hash of the token", async () => {
    const browser = createBrowser(createTestApp({ now: T0 }), testEnv.env);
    const storyId = await createStory(browser);
    const token = browser.cookies.get("andthen_bt") ?? "";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const expected = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");

    const row = await testEnv.env.DB.prepare(
      "SELECT browser_token_hash AS hash FROM participants WHERE story_id = ?",
    )
      .bind(storyId)
      .first();

    expect(row).toEqual({ hash: expected });
  });
});

describe("the default app", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("uses the real clock and random story IDs", async () => {
    const before = Date.now();
    const ana = createBrowser(defaultApp, testEnv.env);
    const other = createBrowser(defaultApp, testEnv.env);

    const first = await createStory(ana);
    const second = await createStory(other);

    const view = await readStory(ana, first);
    expect(view.contributions[0]?.createdAt).toBeGreaterThanOrEqual(before);
    expect(view.contributions[0]?.createdAt).toBeLessThanOrEqual(Date.now());
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[a-z0-9]{5}$/);
  });
});
