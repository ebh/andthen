import { Hono } from "hono";

import type { HealthResponse } from "../shared/api";
import { normaliseStoryId } from "../shared/validation";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").run();
  const body: HealthResponse = { status: "ok" };

  return c.json(body);
});

// TODO(Phase 4): check Origin and resolve the participant before forwarding.
app.get("/api/stories/:id/live", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected a WebSocket upgrade", 426);
  }

  const storyId = normaliseStoryId(c.req.param("id"));
  if (storyId === null) {
    return c.notFound();
  }

  return c.env.STORY_ROOM.getByName(storyId).fetch(c.req.raw);
});
