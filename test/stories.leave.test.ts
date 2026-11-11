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
import { userIdOf } from "./support/users";

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
    // Dee leaves first to prove a non-holder's leave only bumps the version; Ben then leaves while
    // holding, which pins that the route passes the turn on from the leaver's own position.
    it("takes a non-holder out and bumps the version, then passes the turn on when the holder leaves", async () => {
      const { storyId, as } = await storyWith([
        nameInTest("Ben"),
        nameInTest("Cal"),
        nameInTest("Dee"),
      ]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      const dee = as(nameInTest("Dee"));
      const before = await readStory(ana, storyId);

      const nonHolder = await leave(dee, storyId);
      const afterNonHolder = await readStory(ana, storyId);

      expect(nonHolder.status).toBe(204);
      expect(names(afterNonHolder)).toEqual([
        nameInTest("Ana"),
        nameInTest("Ben"),
        nameInTest("Cal"),
      ]);
      expect(afterNonHolder.turn).toEqual({ ...before.turn, version: before.turn.version + 1 });
      expect((await readStory(ben, storyId)).turn.holderId).toBe(before.turn.holderId);

      clock.now = T0 + 1000;

      const holder = await leave(ben, storyId);
      const view = await readStory(ana, storyId);

      expect(holder.status).toBe(204);
      expect(names(view)).toEqual([nameInTest("Ana"), nameInTest("Cal")]);
      expect(view.turn.holderId).toBe(view.participants[1]?.id);
      expect(view.turn.endsAt).toBe(T0 + 1000 + TURN_WINDOW_MS);
    });

    // Ben's passage must stay under his name after he leaves: the author name comes from a SQL
    // join, not from the participant list. Every later round is refused with left_story, and
    // the join route reports already_joined and name_taken because the name belongs to the user.
    it("tells a leaver their name and the opening, 403 left_story, and refuses every route to them", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      const written = await ben.post(`/api/stories/${storyId}/passages`, {
        text: "Ben's line.",
        turnVersion: 1,
        startsParagraph: false,
      });
      await leave(ben, storyId);

      const response = await ben.get(`/api/stories/${storyId}`);

      expect(written.status).toBe(201);
      expect(response.status).toBe(403);
      expect(leftStoryErrorBodySchema.parse(await response.json())).toEqual({
        error: "left_story",
        displayName: nameInTest("Ben"),
        opening: "Once upon a time.",
        openingAuthorId: await userIdOf(testEnv.env.DB, ana),
      });
      const view = await readStory(ana, storyId);
      expect(view.participants).toHaveLength(1);
      expect(view.passages.map((turn) => turn.authorName)).toEqual([
        nameInTest("Ana"),
        nameInTest("Ben"),
      ]);

      const refused = [
        await leave(ben, storyId),
        await ben.post(`/api/stories/${storyId}/passages`, {
          text: "Hi.",
          turnVersion: 1,
          startsParagraph: false,
        }),
        await ben.post(`/api/stories/${storyId}/skip`, { turnVersion: 1 }),
        await ben.post(`/api/stories/${storyId}/suggestions`, {}),
        await ben.get(`/api/stories/${storyId}/live`, {
          headers: { Upgrade: "websocket", Origin: "http://localhost" },
        }),
      ];

      for (const refusal of refused) {
        expect(refusal.status).toBe(403);
        expect(await readError(refusal)).toBe("left_story");
      }

      const join = await ben.post(`/api/stories/${storyId}/participants`, {});

      expect(join.status).toBe(409);
      expect(await readError(join)).toBe("already_joined");

      const nameTaken = await newBrowser().post(`/api/stories/${storyId}/participants`, {
        displayName: nameInTest("Ben").toLowerCase(),
      });

      expect(nameTaken.status).toBe(409);
      expect(await readError(nameTaken)).toBe("name_taken");
    });

    it("refuses someone who was never in the story, an unknown story and a body with anything in it", async () => {
      const { storyId, as } = await storyWith([]);
      const ana = as(nameInTest("Ana"));

      const stranger = await leave(newBrowser(), storyId);
      const unknown = await leave(newBrowser(), "zzzzz");
      const junk = await ana.post(`/api/stories/${storyId}/leave`, { turnVersion: 1 });

      expect(stranger.status).toBe(403);
      expect(await readError(stranger)).toBe("not_participant");
      expect(unknown.status).toBe(404);
      expect(junk.status).toBe(400);
      expect(await readError(junk)).toBe("bad_request");
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

    it("refuses a rejoin from someone in the story, a stranger, an unknown story and a body with anything in it", async () => {
      const { storyId, as } = await storyWith([nameInTest("Ben")]);
      const ana = as(nameInTest("Ana"));
      const ben = as(nameInTest("Ben"));
      await leave(ben, storyId);

      const inStory = await rejoin(ana, storyId);
      const stranger = await rejoin(newBrowser(), storyId);
      const unknown = await rejoin(ben, "zzzzz");
      const junk = await ben.post(`/api/stories/${storyId}/rejoin`, { name: nameInTest("Ben") });

      expect(inStory.status).toBe(409);
      expect(await readError(inStory)).toBe("already_joined");
      expect(stranger.status).toBe(403);
      expect(await readError(stranger)).toBe("not_participant");
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
