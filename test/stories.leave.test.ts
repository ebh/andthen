import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { leftStoryErrorBodySchema } from "../src/shared/api";
import { TURN_WINDOW_MS } from "../src/shared/validation";
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
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("leaving and rejoining a story", () => {
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

  // Ana starts a story, then each name joins in order. The first joiner holds the turn.
  async function storyWith(
    joinerNames: string[],
  ): Promise<{ storyId: string; as: (name: string) => Browser }> {
    clock.now = T0;
    const ana = newBrowser();
    const storyId = await createStory(ana, nameInTest("Ana"));
    const browsers = new Map<string, Browser>([[nameInTest("Ana"), ana]]);
    for (const name of joinerNames) {
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

  describe("POST /api/stories/:storyId/leave", () => {
    it("takes a writer who does not hold the turn out of the story and bumps the version", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben"), nameInTest("Cal")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      const cal = as(nameInTest("Cal"));
      const before = await readStory(ana, storyId);

      const response = await leave(cal, storyId);
      const after = await readStory(ana, storyId);

      expect(response.status).toBe(204);
      expect(names(after)).toEqual([nameInTest("Ana"), nameInTest("Ben")]);
      expect(after.turn).toEqual({ ...before.turn, version: before.turn.version + 1 });
      expect((await readStory(ben, storyId)).turn.holderId).toBe(before.turn.holderId);
    });

    it("passes the turn on with a fresh window when the holder leaves", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben"), nameInTest("Cal")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      clock.now = T0 + 1000;

      const response = await leave(ben, storyId);
      const view = await readStory(ana, storyId);

      expect(response.status).toBe(204);
      expect(names(view)).toEqual([nameInTest("Ana"), nameInTest("Cal")]);
      expect(view.turn.holderId).toBe(view.participants[1]?.id);
      expect(view.turn.endsAt).toBe(T0 + 1000 + TURN_WINDOW_MS);
    });

    it("makes the story wait when the holder leaves and the writer left wrote last", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));

      await leave(ben, storyId);
      const view = await readStory(ana, storyId);

      expect(names(view)).toEqual([nameInTest("Ana")]);
      expect(view.turn.holderId).toBeNull();
      expect(view.turn.endsAt).toBeNull();
    });

    it("keeps a leaver's passages in the story under their name", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben"), nameInTest("Cal")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      const written = await ben.post(`/api/stories/${storyId}/passages`, {
        text: "Ben's line.",
        turnVersion: 2,
        startsParagraph: false,
      });

      await leave(ben, storyId);
      const view = await readStory(ana, storyId);

      expect(written.status).toBe(201);
      expect(view.passages.map((turn) => turn.authorName)).toEqual([
        nameInTest("Ana"),
        nameInTest("Ben"),
      ]);
      expect(names(view)).toEqual([nameInTest("Ana"), nameInTest("Cal")]);
    });

    it("leaves the story open when its only writer leaves", async () => {
      const { storyId, as } = await storyWith([]);
      const ana = as(nameInTest("Ana"));

      const response = await leave(ana, storyId);
      const newcomer = newBrowser();
      const joined = await newcomer.post(`/api/stories/${storyId}/participants`, {
        displayName: nameInTest("Dee"),
      });
      const view = await readStory(newcomer, storyId);

      expect(response.status).toBe(204);
      expect(joined.status).toBe(201);
      expect(names(view)).toEqual([nameInTest("Dee")]);
      expect(view.turn.holderId).toBe(view.me);
    });

    it("tells a leaver their name and the opening passage, with 403 left_story", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);

      const response = await ben.get(`/api/stories/${storyId}`);

      expect(response.status).toBe(403);
      expect(leftStoryErrorBodySchema.parse(await response.json())).toEqual({
        error: "left_story",
        displayName: nameInTest("Ben"),
        opening: "Once upon a time.",
      });
      expect((await readStory(ana, storyId)).participants).toHaveLength(1);
    });

    it.each([
      ["leaving again", (b: Browser, id: string) => leave(b, id)],
      [
        "writing",
        (b: Browser, id: string) =>
          b.post(`/api/stories/${id}/passages`, {
            text: "Hi.",
            turnVersion: 1,
            startsParagraph: false,
          }),
      ],
      [
        "skipping",
        (b: Browser, id: string) => b.post(`/api/stories/${id}/skip`, { turnVersion: 1 }),
      ],
      [
        "asking for suggestions",
        (b: Browser, id: string) => b.post(`/api/stories/${id}/suggestions`, {}),
      ],
      [
        "opening the live socket",
        (b: Browser, id: string) =>
          b.get(`/api/stories/${id}/live`, {
            headers: { Upgrade: "websocket", Origin: "http://localhost" },
          }),
      ],
    ])("refuses a leaver %s with 403 left_story", async (_action, act) => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);

      const response = await act(ben, storyId);

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("left_story");
    });

    it("lets a leaver join again only through rejoin, not the join route", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);

      const response = await ben.post(`/api/stories/${storyId}/participants`, {});

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("already_joined");
    });

    it("keeps a leaver's name taken", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);

      const response = await newBrowser().post(`/api/stories/${storyId}/participants`, {
        displayName: nameInTest("Ben").toLowerCase(),
      });

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("name_taken");
    });

    it("refuses someone who was never in the story, and an unknown story", async () => {
      const { storyId } = await storyWith([]);

      const stranger = await leave(newBrowser(), storyId);
      const unknown = await leave(newBrowser(), "zzzzz");

      expect(stranger.status).toBe(403);
      expect(await readError(stranger)).toBe("not_participant");
      expect(unknown.status).toBe(404);
    });

    it("refuses a body with anything in it", async () => {
      const { storyId, as } = await storyWith([]);
      const ana = as(nameInTest("Ana"));

      const response = await ana.post(`/api/stories/${storyId}/leave`, { turnVersion: 1 });

      expect(response.status).toBe(400);
      expect(await readError(response)).toBe("bad_request");
      expect(names(await readStory(ana, storyId))).toEqual([nameInTest("Ana")]);
    });

    it("tells the room about the new version", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      const notified: number[] = [];
      const env = {
        DB: testEnv.env.DB,
        STORY_ROOM: {
          getByName: () => ({
            notify: (message: { version: number }) => {
              notified.push(message.version);
              return Promise.resolve();
            },
          }),
        },
      };
      const before = (await readStory(ana, storyId)).turn.version;

      const response = await ben.post(`/api/stories/${storyId}/leave`, {}, { env });
      await Promise.all(ben.backgroundWork);

      expect(response.status).toBe(204);
      expect(notified).toEqual([before + 1]);
    });
  });

  describe("POST /api/stories/:storyId/rejoin", () => {
    it("puts a writer back at the end of the turn order under their old name", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben"), nameInTest("Cal")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);
      const before = await readStory(ana, storyId);

      const response = await rejoin(ben, storyId);
      const after = await readStory(ben, storyId);

      expect(response.status).toBe(204);
      expect(names(after)).toEqual([nameInTest("Ana"), nameInTest("Cal"), nameInTest("Ben")]);
      expect(after.me).toBe(after.participants[2]?.id);
      expect(after.turn).toEqual({ ...before.turn, version: before.turn.version + 1 });
    });

    it("gives the turn to a writer who comes back to a waiting story", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      await leave(ana, storyId);
      await leave(ben, storyId);

      const response = await rejoin(ben, storyId);
      const view = await readStory(ben, storyId);

      expect(response.status).toBe(204);
      expect(view.turn.holderId).toBe(view.me);
    });

    it("keeps a story waiting when the one who wrote last comes back", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);
      await leave(ana, storyId);

      const response = await rejoin(ana, storyId);
      const view = await readStory(ana, storyId);

      expect(response.status).toBe(204);
      expect(names(view)).toEqual([nameInTest("Ana")]);
      expect(view.turn.holderId).toBeNull();
    });

    it("does not let a writer who wrote last take the next turn by leaving and coming back", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben"), nameInTest("Cal")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      // Ben writes (turn passes to Cal), then leaves and rejoins; Cal still holds.
      await ben.post(`/api/stories/${storyId}/passages`, {
        text: "Ben's line.",
        turnVersion: 2,
        startsParagraph: false,
      });
      await leave(ben, storyId);
      await rejoin(ben, storyId);

      const view = await readStory(ana, storyId);

      expect(names(view)).toEqual([nameInTest("Ana"), nameInTest("Cal"), nameInTest("Ben")]);
      expect(view.turn.holderId).toBe(view.participants[1]?.id);
    });

    it("refuses someone who is already in the story with 409 already_joined", async () => {
      const { storyId, as } = await storyWith([]);
      const ana = as(nameInTest("Ana"));

      const response = await rejoin(ana, storyId);

      expect(response.status).toBe(409);
      expect(await readError(response)).toBe("already_joined");
    });

    it("refuses someone who was never in the story with 403 not_participant", async () => {
      const { storyId } = await storyWith([]);

      const response = await rejoin(newBrowser(), storyId);

      expect(response.status).toBe(403);
      expect(await readError(response)).toBe("not_participant");
    });

    it("answers 404 for an unknown story and 400 for a body with anything in it", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);

      const unknown = await rejoin(ben, "zzzzz");
      const junk = await ben.post(`/api/stories/${storyId}/rejoin`, { name: nameInTest("Ben") });

      expect(unknown.status).toBe(404);
      expect(junk.status).toBe(400);
    });
  });
});

function leave(browser: Browser, storyId: string): Promise<Response> {
  return browser.post(`/api/stories/${storyId}/leave`, {});
}

function rejoin(browser: Browser, storyId: string): Promise<Response> {
  return browser.post(`/api/stories/${storyId}/rejoin`, {});
}

function names(view: { participants: { displayName: string }[] }): string[] {
  return view.participants.map((participant) => participant.displayName);
}
