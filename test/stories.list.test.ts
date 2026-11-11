import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  myStoriesResponseSchema,
  type MyStoriesResponse,
  type StorySummary,
} from "../src/shared/api";
import { TURN_WINDOW_MS } from "../src/shared/validation";
import {
  createBrowser,
  createStory,
  createTestApp,
  joinStory,
  readError,
  T0,
  type Browser,
  type Clock,
  nameInTest,
} from "./support/browser";
import { createTestEnv, type TestEnv } from "./support/testEnv";
import { userIdOf } from "./support/users";

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

  // One story walked through its steps. SQL builds each caller's own view (myPosition, who holds
  // the turn, the writer count), and the clock reaches the expiry applied to the list.
  it("shows a started story as waiting, then each caller's view once a writer joins, then an expired turn", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const storyId = await createStory(ana, nameInTest("Ana"), "The bell rang once.");

    expect(await listStories(ana)).toEqual([
      {
        id: storyId,
        opening: "The bell rang once.",
        openingAuthorId: await userIdOf(testEnv.env.DB, ana),
        holderName: null,
        isMyTurn: false,
        endsAt: null,
        writerCount: 1,
      },
    ]);

    await joinStory(ben, storyId, nameInTest("Ben"));
    const [forAna] = await listStories(ana);
    const [forBen] = await listStories(ben);

    expect(forAna).toMatchObject({
      holderName: nameInTest("Ben"),
      isMyTurn: false,
      writerCount: 2,
    });
    expect(forBen).toMatchObject({ holderName: nameInTest("Ben"), isMyTurn: true, writerCount: 2 });
    expect(forBen?.endsAt).toBe(T0 + TURN_WINDOW_MS);

    clock.now = T0 + TURN_WINDOW_MS;
    const [expiredForBen] = await listStories(ben);

    expect(expiredForBen).toMatchObject({
      holderName: nameInTest("Ben"),
      isMyTurn: true,
      endsAt: T0 + 2 * TURN_WINDOW_MS,
    });
  });

  it("lists only the stories the caller is in", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const ben = newBrowser();
    const first = await createStory(ana);
    const second = await createStory(ana);
    const third = await createStory(ben, nameInTest("Ben"));

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
    await joinStory(ben, storyId, nameInTest("Ben"));

    await ben.post(`/api/stories/${storyId}/leave`, {});
    expect(await listStories(ben)).toEqual([]);
    expect(await listStories(ana)).toMatchObject([{ writerCount: 1, holderName: null }]);

    await ben.post(`/api/stories/${storyId}/rejoin`, {});
    expect(await listStories(ben)).toHaveLength(1);
  });

  it("pages the list with limit and cursor, and ends with a null cursor", async () => {
    clock.now = T0;
    const ana = newBrowser();
    const first = await createStory(ana, nameInTest("Ana"), "First.");
    clock.now = T0 + 1000;
    const second = await createStory(ana, nameInTest("Ana"), "Second.");
    clock.now = T0 + 2000;
    const third = await createStory(ana, nameInTest("Ana"), "Third.");

    const page1 = await listPage(ana, "limit=2");
    const page2 = await listPage(ana, `limit=2&cursor=${page1.nextCursor ?? ""}`);

    expect(page1.stories.map(({ id }) => id)).toEqual([third, second]);
    expect(page1.nextCursor).not.toBeNull();
    expect(page2.stories.map(({ id }) => id)).toEqual([first]);
    expect(page2.nextCursor).toBeNull();
  });

  it.each([
    ["a limit of zero", "limit=0"],
    ["a cursor this API never made", "cursor=not-a-cursor"],
  ])("answers 400 bad_request for %s", async (_name, query) => {
    const response = await newBrowser().get(`/api/stories?${query}`);

    expect(response.status).toBe(400);
    expect(await readError(response)).toBe("bad_request");
  });
});

async function listPage(browser: Browser, query: string): Promise<MyStoriesResponse> {
  const response = await browser.get(`/api/stories?${query}`);
  expect(response.status).toBe(200);

  return myStoriesResponseSchema.parse(await response.json());
}

async function listStories(browser: Browser): Promise<StorySummary[]> {
  const response = await browser.get("/api/stories");
  expect(response.status).toBe(200);

  return myStoriesResponseSchema.parse(await response.json()).stories;
}
