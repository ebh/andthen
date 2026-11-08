import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createStoryResponseSchema, myStoriesResponseSchema } from "../src/shared/api";
import { LIVE_SUBPROTOCOL } from "../src/shared/liveSubprotocol";
import {
  createBrowser,
  createPhone,
  createStory,
  createTestApp,
  joinStory,
  newDeviceToken,
  readError,
  readStory,
  T0,
  type Browser,
  type Clock,
} from "./support/browser";
import { signSessionToken } from "./support/sessionToken";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const ORIGIN = "http://localhost";

// The guard runs before the room is reached, so the room only has to accept what it is sent.
const quietRoom = {
  getByName: () => ({
    fetch: () => Promise.resolve(new Response("room")),
    notify: () => Promise.resolve(),
  }),
};

describe("a request with a device token and no Origin (the store apps)", () => {
  let testEnv: TestEnv;
  let env: Env;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock);

  beforeAll(async () => {
    testEnv = await createTestEnv();
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- a partial Env is the point
    env = Object.assign(Object.create(null), testEnv.env, { STORY_ROOM: quietRoom });
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  const phone = () => createPhone(app, env);
  const web = () => createBrowser(app, env, ORIGIN);

  async function twoPhoneStory(): Promise<{ ana: Browser; ben: Browser; storyId: string }> {
    clock.now = T0;
    const [ana, ben] = [phone(), phone()];
    const storyId = await createStory(ana);
    await joinStory(ben, storyId, "Ben");

    return { ana, ben, storyId };
  }

  it("lists, creates, joins and writes, and is never given a cookie", async () => {
    const ana = phone();
    const ben = phone();

    const created = await ana.post("/api/stories", {
      displayName: "Ana",
      opening: "Once upon a time.",
    });
    expect(created.status).toBe(201);
    expect(created.headers.getSetCookie()).toEqual([]);
    const { storyId } = createStoryResponseSchema.parse(await created.json());

    const listed = await ana.get("/api/stories");
    expect(myStoriesResponseSchema.parse(await listed.json()).stories).toHaveLength(1);

    const joined = await ben.post(`/api/stories/${storyId}/participants`, { displayName: "Ben" });
    expect(joined.status).toBe(201);
    expect(joined.headers.getSetCookie()).toEqual([]);

    const written = await ben.post(`/api/stories/${storyId}/contributions`, {
      text: " And then Ben wrote. ",
      turnVersion: 1,
      startsParagraph: false,
    });
    expect(written.status).toBe(204);
    expect((await readStory(ana, storyId)).contributions).toHaveLength(2);
  });

  it("is the same user on every request with the same token", async () => {
    const token = newDeviceToken();
    const first = createPhone(app, env, token);
    const storyId = await createStory(first);

    const again = createPhone(app, env, token);

    const listed = await again.get("/api/stories");
    expect(myStoriesResponseSchema.parse(await listed.json()).stories.map((s) => s.id)).toEqual([
      storyId,
    ]);
  });

  it("opens the live socket", async () => {
    const { ben, storyId } = await twoPhoneStory();

    const response = await ben.get(`/api/stories/${storyId}/live`, {
      headers: { Upgrade: "websocket" },
    });

    expect(await response.text()).toBe("room");
  });

  it("opens the live socket with only a session token in the subprotocols", async () => {
    const { ben, storyId } = await twoPhoneStory();
    ben.deviceToken = null;
    const token = await signSessionToken("clerk-nobody", ORIGIN);

    const response = await ben.get(`/api/stories/${storyId}/live`, {
      headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${LIVE_SUBPROTOCOL}, ${token}` },
    });

    // Past the Origin guard: the token names no participant of this story.
    expect(await readError(response)).toBe("not_participant");
  });

  it("is refused on a write with a wrong Origin, even with the header", async () => {
    const ana = phone();

    const response = await ana.post(
      "/api/stories",
      { displayName: "Ana", opening: "Once upon a time." },
      { origin: "https://evil.example" },
    );

    expect(response.status).toBe(403);
    expect(await readError(response)).toBe("forbidden_origin");
  });

  it("is refused on a write with Origin 'null', even with the header", async () => {
    const ana = phone();

    const response = await ana.post(
      "/api/stories",
      { displayName: "Ana", opening: "Once upon a time." },
      { origin: "null" },
    );

    expect(await readError(response)).toBe("forbidden_origin");
  });

  it("passes the Origin guard with only a session token", async () => {
    const ana = web();
    ana.sessionToken = await signSessionToken("clerk-ana", ORIGIN);

    const response = await ana.post(
      "/api/stories",
      { displayName: "Ana", opening: "Once upon a time." },
      { origin: null },
    );

    expect(response.status).toBe(201);
  });

  it("answers 400 to a malformed header, on a read and on a write", async () => {
    const ana = phone();
    ana.deviceToken = "not-a-token";

    const read = await ana.get("/api/stories");
    const write = await ana.post("/api/stories", {
      displayName: "Ana",
      opening: "Once upon a time.",
    });

    expect([read.status, write.status]).toEqual([400, 400]);
    expect(await readError(write)).toBe("bad_request");
  });

  it("answers 400 to an empty header instead of treating it as no token", async () => {
    const ana = phone();
    ana.deviceToken = "";

    const response = await ana.get("/api/stories");

    expect(response.status).toBe(400);
  });

  it("decides alone when a cookie names another user", async () => {
    const { ana, storyId } = await twoPhoneStory();
    const browser = web();
    await createStory(browser);
    const sameToken = createPhone(app, env, ana.deviceToken ?? "");
    sameToken.cookies.set("andthen_bt", browser.cookies.get("andthen_bt") ?? "");

    const response = await sameToken.get(`/api/stories/${storyId}`);

    // Ana's header wins over the cookie of a different user, who is not in this story.
    expect(response.status).toBe(200);
  });

  it("is attached to the account on sign-in", async () => {
    const ana = phone();
    const storyId = await createStory(ana);
    ana.sessionToken = await signSessionToken("clerk-phone", ORIGIN);

    const attached = await ana.put("/api/users/me/account", {});
    expect(attached.status).toBe(204);

    ana.deviceToken = null;
    const listed = await ana.get("/api/stories");
    expect(myStoriesResponseSchema.parse(await listed.json()).stories.map((s) => s.id)).toEqual([
      storyId,
    ]);
  });
});

describe("a request with no Origin and no credential", () => {
  let testEnv: TestEnv;
  const clock: Clock = { now: T0 };
  const app = createTestApp(clock);

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("is refused on a write, even with a cookie", async () => {
    const browser = createBrowser(app, testEnv.env, ORIGIN);
    await createStory(browser);

    const response = await browser.post(
      "/api/stories",
      { displayName: "Ana", opening: "Once upon a time." },
      { origin: null },
    );

    expect(response.status).toBe(403);
    expect(await readError(response)).toBe("forbidden_origin");
  });

  it("is refused on a live upgrade", async () => {
    const browser = createBrowser(app, testEnv.env, ORIGIN);
    const storyId = await createStory(browser);

    const response = await browser.get(`/api/stories/${storyId}/live`, {
      headers: { Upgrade: "websocket" },
    });

    expect(await readError(response)).toBe("forbidden_origin");
  });

  it("is not excused by subprotocols on a request that is not an upgrade", async () => {
    const browser = createBrowser(app, testEnv.env, ORIGIN);

    const response = await browser.post(
      "/api/stories",
      { displayName: "Ana", opening: "Once upon a time." },
      { origin: null, headers: { "Sec-WebSocket-Protocol": `${LIVE_SUBPROTOCOL}, some-token` } },
    );

    expect(await readError(response)).toBe("forbidden_origin");
  });
});
