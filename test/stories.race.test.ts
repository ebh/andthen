import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

interface Story {
  storyId: string;
  as: (name: string) => Browser;
}

async function raced(
  requests: (() => Promise<Response>)[],
): Promise<{ statuses: number[]; errors: string[] }> {
  const responses = await Promise.all(requests.map((request) => request()));
  const failures = responses.filter(
    (response) => response.status !== 204 && response.status !== 201,
  );

  return {
    statuses: responses.map((response) => response.status).toSorted((a, b) => a - b),
    errors: await Promise.all(failures.map(readError)),
  };
}

// Every race below holds all requests at the story load until each has loaded, so they all
// write against the same stored version. Exactly one write may win; the rest get 409 stale_turn.
describe("concurrent writes to one story", () => {
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

  // Ana creates the story, then each name joins in order.
  async function storyWith(names: string[]): Promise<Story> {
    clock.now = T0;
    const ana = newBrowser();
    const storyId = await createStory(ana);
    const browsers = new Map<string, Browser>([["Ana", ana]]);
    for (const name of names) {
      const browser = newBrowser();
      await joinStory(browser, storyId, name);
      browsers.set(name, browser);
    }

    return {
      storyId,
      as: (name) => {
        const browser = browsers.get(name);
        if (browser === undefined) {
          throw new Error(`${name} is not in the story`);
        }

        return browser;
      },
    };
  }

  const gated = (requests: number) => ({ env: { DB: gateLoads(testEnv.env.DB, requests) } });

  it("lets one of several identical contributions win", async () => {
    const { as, storyId } = await storyWith(["Ben"]);
    const ben = as("Ben");
    const gate = gated(4);
    const send = () =>
      ben.post(`/api/stories/${storyId}/contributions`, { text: "Mine.", turnVersion: 1 }, gate);

    const { statuses, errors } = await raced([send, send, send, send]);

    expect(statuses).toEqual([204, 409, 409, 409]);
    expect(errors).toEqual(["stale_turn", "stale_turn", "stale_turn"]);
    expect((await readStory(ben, storyId)).contributions).toHaveLength(2);
  });

  it("lets one of a contribution and a skip win", async () => {
    const { as, storyId } = await storyWith(["Ben", "Cat"]);
    const [ben, cat] = [as("Ben"), as("Cat")];
    const gate = gated(2);

    const { statuses, errors } = await raced([
      () =>
        ben.post(`/api/stories/${storyId}/contributions`, { text: "Ben.", turnVersion: 2 }, gate),
      () => cat.post(`/api/stories/${storyId}/skip`, { turnVersion: 2 }, gate),
    ]);

    expect(statuses).toEqual([204, 409]);
    expect(errors).toEqual(["stale_turn"]);
    const view = await readStory(cat, storyId);
    expect(view.turn.version).toBe(3);
    expect(view.contributions.length).toBeLessThanOrEqual(2);
  });

  it("lets one of two skips by different people win", async () => {
    const { as, storyId } = await storyWith(["Ben", "Cat", "Dee"]);
    const [ana, cat] = [as("Ana"), as("Cat")];
    const gate = gated(2);

    const { statuses, errors } = await raced([
      () => ana.post(`/api/stories/${storyId}/skip`, { turnVersion: 3 }, gate),
      () => cat.post(`/api/stories/${storyId}/skip`, { turnVersion: 3 }, gate),
    ]);

    expect(statuses).toEqual([204, 409]);
    expect(errors).toEqual(["stale_turn"]);
    expect((await readStory(ana, storyId)).turn.version).toBe(4);
  });

  it("lets one of several joins win, and adds no participant for the losers", async () => {
    const { as, storyId } = await storyWith(["Ben"]);
    const ana = as("Ana");
    const joiners = ["Cat", "Dee", "Eve"].map((name) => ({ name, browser: newBrowser() }));
    const gate = gated(3);

    const { statuses, errors } = await raced(
      joiners.map(
        ({ name, browser }) =>
          () =>
            browser.post(`/api/stories/${storyId}/participants`, { displayName: name }, gate),
      ),
    );

    expect(statuses).toEqual([201, 409, 409]);
    expect(errors).toEqual(["stale_turn", "stale_turn"]);
    const view = await readStory(ana, storyId);
    expect(view.participants).toHaveLength(3);
    expect(view.turn.version).toBe(2);
  });

  it("fails a contribution that raced a join, because the join changes the rotation", async () => {
    const { as, storyId } = await storyWith(["Ben"]);
    const ben = as("Ben");
    const cat = newBrowser();
    const gate = gated(2);

    const { statuses } = await raced([
      () =>
        ben.post(`/api/stories/${storyId}/contributions`, { text: "Ben.", turnVersion: 1 }, gate),
      () => cat.post(`/api/stories/${storyId}/participants`, { displayName: "Cat" }, gate),
    ]);

    // Either the join won (201, three participants) or the contribution did (204, two passages).
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    expect(statuses.filter((status) => status === 201 || status === 204)).toHaveLength(1);
    const view = await readStory(ben, storyId);
    expect(view.turn.version).toBe(2);
    expect(view.participants.length + view.contributions.length).toBe(4);
  });

  it("keeps the story consistent when joins race without a gate", async () => {
    const { as, storyId } = await storyWith(["Ben"]);
    const ana = as("Ana");
    const names = ["Cat", "Dee", "Eve", "Fay", "Gus", "Hal"];

    const { statuses } = await raced(
      names.map(
        (name) => () =>
          newBrowser().post(`/api/stories/${storyId}/participants`, { displayName: name }),
      ),
    );

    const wins = statuses.filter((status) => status === 201).length;
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    const positions = await testEnv.env.DB.prepare(
      "SELECT position FROM participants WHERE story_id = ? ORDER BY position",
    )
      .bind(storyId)
      .all();
    expect(positions.results.map((row) => row["position"])).toEqual(
      Array.from({ length: 2 + wins }, (_, index) => index),
    );
    expect((await readStory(ana, storyId)).turn.version).toBe(1 + wins);
  });
});
