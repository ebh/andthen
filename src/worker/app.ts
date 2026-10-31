import { Hono } from "hono";

import type { HealthResponse } from "../shared/api";
import { guardMutation, handleError, handleNotFound, limitBody, noStore } from "./http";
import { newStoryId } from "./ids";
import { storyRoutes, type StoryDeps } from "./routes/stories";
import { selectSuggestionProvider } from "./suggestions/select";

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

  return app;
}

export const app = createApp({
  now: () => Date.now(),
  newStoryId: () => newStoryId(),
  suggestionProvider: selectSuggestionProvider,
});
