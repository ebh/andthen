import { Hono } from "hono";

import type { HealthResponse } from "../shared/api";
import { MIN_API_LEVEL } from "../shared/apiLevel";
import {
  guardMutation,
  handleError,
  handleNotFound,
  limitBody,
  noStore,
  requireApiLevel,
} from "./http";
import { newStoryId } from "./ids";
import { storyRoutes, type StoryDeps } from "./routes/stories";
import { selectSuggestionProvider } from "./suggestions/select";

export function createApp(
  deps: StoryDeps & {
    /** The oldest client API level to serve; tests raise it to exercise `client_outdated`. */
    minApiLevel?: number | undefined;
  },
): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.onError(handleError);
  app.notFound(handleNotFound);
  // The level check runs before the origin, content-type and body checks, so a stale client
  // always gets `client_outdated`, whatever else is wrong with its request.
  app.use(
    "/api/*",
    noStore,
    requireApiLevel(deps.minApiLevel ?? MIN_API_LEVEL),
    guardMutation,
    limitBody,
  );

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
