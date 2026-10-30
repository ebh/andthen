import { Hono } from "hono";

import type { HealthResponse } from "../shared/api";
import { normaliseStoryId } from "../shared/validation";
import { guardMutation, handleError, handleNotFound, limitBody, noStore } from "./http";
import { newStoryId } from "./ids";
import { storyRoutes, type StoryDeps } from "./routes/stories";

export function createApp(deps: StoryDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.onError(handleError);
  app.notFound(handleNotFound);
  app.use("/api/*", noStore, guardMutation, limitBody);

  app.get("/api/health", async (c) => {
    await c.env.DB.prepare("SELECT 1").run();
    const body: HealthResponse = { status: "ok" };

    return c.json(body);
  });

  app.route("/", storyRoutes(deps));

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

  return app;
}

export const app = createApp({ now: () => Date.now(), newStoryId: () => newStoryId() });
