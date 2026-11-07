import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { myStoriesResponseSchema, type StorySummary } from "../src/shared/api";
import { TURN_WINDOW_MS } from "../src/shared/validation";
import {
  createBrowser,
  createStory,
  createTestApp,
  joinStory,
  T0,
  type Browser,
  type Clock,
} from "./support/browser";
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("GET /api/stories", () => {
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
  const countUsers = () => testEnv.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first("n");

  it("is empty for a browser with no cookie, and issues none", async () => {
    clock.now = T0;
    const stranger = newBrowser();

    const before = await countUsers();

    expect(await listStories(stranger)).toEqual([]);
    expect(stranger.cookies.size).toBe(0);
    expect(await countUsers()).toBe(before);
  });

  it("is empty for a browser that is in no story", async () => {
    clock.now = T0;
    await createStory(newBrowser());

    expect(await listStories(newBrowser())).toEqual([]);
  });

  it("shows a story the caller started as waiting, with its opening and one writer", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const storyId = await createStory(ana, "Ana", "The bell rang once.");

    expect(await listStories(ana)).toEqual([
      {
        id: storyId,
        opening: "The bell rang once.",
        holderName: null,
        isMyTurn: false,
        endsAt: null,
        writerCount: 1,
      },
    ]);
  });

  it("shows each writer whose turn it is, and the holder to the rest", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");

    const [forAna] = await listStories(ana);
    const [forBen] = await listStories(ben);

    expect(forAna).toMatchObject({ holderName: "Ben", isMyTurn: false, writerCount: 2 });
    expect(forBen).toMatchObject({ holderName: "Ben", isMyTurn: true, writerCount: 2 });
    expect(forBen?.endsAt).toBe(T0 + TURN_WINDOW_MS);
  });

  it("lists only the stories the caller is in", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const first = await createStory(ana);
    const second = await createStory(ana);
    const third = await createStory(ben);

    expect((await listStories(ana)).map(({ id }) => id).toSorted()).toEqual(
      [first, second].toSorted(),
    );
    expect((await listStories(ben)).map(({ id }) => id)).toEqual([third]);
  });

  it("drops a story the caller left and brings it back when they rejoin", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");

    await ben.post(`/api/stories/${storyId}/leave`, {});
    expect(await listStories(ben)).toEqual([]);
    expect(await listStories(ana)).toHaveLength(1);

    await ben.post(`/api/stories/${storyId}/rejoin`, {});
    expect(await listStories(ben)).toHaveLength(1);
  });

  it("counts only the writers who are still in the story", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");

    await ben.post(`/api/stories/${storyId}/leave`, {});

    expect(await listStories(ana)).toMatchObject([{ writerCount: 1, holderName: null }]);
  });

  it("lists the stories whose turn it is first, then the newest passage first", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    // Ben starts `quiet` and `recent`, and Ana joins and takes the turn in each. Ana starts `mine`
    // last, so it has the newest passage, but Ben holds the turn in it.
    const quiet = await createStory(ben, "Ben", "Quiet.");
    await joinStory(ana, quiet, "Ana");
    clock.now = T0 + 1000;
    const recent = await createStory(ben, "Ben", "Recent.");
    await joinStory(ana, recent, "Ana");
    clock.now = T0 + 2000;
    const mine = await createStory(ana, "Ana", "Mine.");
    await joinStory(ben, mine, "Ben");

    const order = (await listStories(ana)).map(({ id }) => id);

    expect(order).toEqual([recent, quiet, mine]);
  });

  it("applies expiry, so a turn that ran out shows its new holder", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const cal = newBrowser();
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");
    await joinStory(cal, storyId, "Cal");
    clock.now = T0 + TURN_WINDOW_MS;

    expect(await listStories(ana)).toMatchObject([
      { holderName: "Cal", isMyTurn: false, endsAt: T0 + 2 * TURN_WINDOW_MS },
    ]);
    expect(await listStories(cal)).toMatchObject([{ isMyTurn: true }]);
  });
});

async function listStories(browser: Browser): Promise<StorySummary[]> {
  const response = await browser.get("/api/stories");
  expect(response.status).toBe(200);

  return myStoriesResponseSchema.parse(await response.json()).stories;
}
