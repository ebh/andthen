import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app } from "../src/worker/app";
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("GET /api/stories/:id/live", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("refuses a request that isn't a WebSocket upgrade", async () => {
    const response = await app.request("/api/stories/abc12/live", {}, testEnv.env);

    expect(response.status).toBe(426);
    expect(await response.text()).toBe("Expected a WebSocket upgrade");
  });

  // StoryRoom can't run under getPlatformProxy, so forwarding fails here (500). This pins only
  // that a valid ID gets past the guard, read from the `:id` param.
  it("passes a valid story ID through to StoryRoom", async () => {
    const response = await app.request(
      "/api/stories/ABC12/live",
      { headers: { Upgrade: "websocket" } },
      testEnv.env,
    );

    expect(response.status).not.toBe(404);
  });

  it("returns 404 for a malformed story ID", async () => {
    const response = await app.request(
      "/api/stories/abc-1/live",
      { headers: { Upgrade: "websocket" } },
      testEnv.env,
    );

    expect(response.status).toBe(404);
  });
});
