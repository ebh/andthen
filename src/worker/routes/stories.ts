import { Hono } from "hono";

import {
  contributeRequestSchema,
  createStoryRequestSchema,
  joinRequestSchema,
  skipRequestSchema,
  type CreateStoryResponse,
  type JoinResponse,
} from "../../shared/api";
import { afterContribution, newStoryState, onJoin, skip } from "../../shared/turnOrder";
import {
  displayNameKey,
  normaliseStoryId,
  validateDisplayName,
  validatePassage,
} from "../../shared/validation";
import { STORY_ID_ATTEMPTS } from "../config";
import { hashBrowserToken, readBrowserToken, readOrIssueBrowserToken } from "../cookies";
import type { ParticipantRow } from "../db/rows";
import {
  addParticipant,
  appendContribution,
  createStory,
  loadStory,
  loadStoryWithContributions,
  saveTurn,
  type CreateStoryInput,
  type Db,
  type LoadedStory,
} from "../db/storyRepo";
import { ApiError, parseJsonBody, requireSameOrigin, type AppContext } from "../http";
import { newId } from "../ids";
import { notifyRoom } from "../live";
import { buildStoryView } from "../storyView";

export interface StoryDeps {
  /** The clock, in epoch milliseconds. Tests set it to control turn expiry. */
  now: () => number;
  /** A fresh story ID; called again after a collision. */
  newStoryId: () => string;
}

export function storyRoutes(deps: StoryDeps): Hono<{ Bindings: Env }> {
  const routes = new Hono<{ Bindings: Env }>();

  routes.post("/api/stories", async (c) => {
    const body = await parseJsonBody(c, createStoryRequestSchema);
    const name = validateDisplayName(body.displayName);
    if (!name.ok) {
      throw new ApiError("invalid_display_name");
    }
    const opening = validatePassage(body.opening);
    if (!opening.ok) {
      throw new ApiError("invalid_passage");
    }

    const now = deps.now();
    const creator = {
      id: newId(),
      displayName: name.value,
      displayNameKey: displayNameKey(name.value),
      position: 0,
      browserTokenHash: await hashBrowserToken(readOrIssueBrowserToken(c)),
    };

    const storyId = await createUnderFreeId(c.env.DB, deps.newStoryId, STORY_ID_ATTEMPTS, (id) => ({
      storyId: id,
      now,
      state: newStoryState(),
      creator,
      opening: { id: newId(), text: opening.value },
    }));
    const response: CreateStoryResponse = { storyId };

    return c.json(response, 201);
  });

  routes.get("/api/stories/:id", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const found = await loadStoryWithContributions(c.env.DB, storyId);
    if (found === null) {
      throw new ApiError("not_found");
    }
    const me = await requireParticipant(c, found.loaded);

    return c.json(buildStoryView(found.loaded, found.contributions, me, deps.now()));
  });

  routes.post("/api/stories/:id/participants", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const body = await parseJsonBody(c, joinRequestSchema);
    const loaded = await requireStory(c, storyId);
    const name = validateDisplayName(body.displayName);
    if (!name.ok) {
      throw new ApiError("invalid_display_name");
    }

    const token = readOrIssueBrowserToken(c);
    const browserTokenHash = await hashBrowserToken(token);
    const key = displayNameKey(name.value);
    if (loaded.participants.some((p) => p.browserTokenHash === browserTokenHash)) {
      throw new ApiError("already_joined");
    }
    if (loaded.participants.some((p) => p.displayNameKey === key)) {
      throw new ApiError("name_taken");
    }

    const now = deps.now();
    const joined = onJoin(loaded.state, now);
    const participant = {
      id: newId(),
      displayName: name.value,
      displayNameKey: key,
      position: joined.joinerPosition,
      browserTokenHash,
    };
    const saved = await addParticipant(c.env.DB, {
      storyId,
      loadedVersion: loaded.state.turnVersion,
      next: joined.state,
      participant,
      joinedAt: now,
    });
    if (!saved) {
      throw new ApiError("stale_turn");
    }

    await notifyRoom(c, storyId, joined.state.turnVersion);

    const response: JoinResponse = { participantId: participant.id };
    return c.json(response, 201);
  });

  routes.post("/api/stories/:id/contributions", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const body = await parseJsonBody(c, contributeRequestSchema);
    const loaded = await requireStory(c, storyId);
    const me = await requireParticipant(c, loaded);
    const passage = validatePassage(body.text);
    if (!passage.ok) {
      throw new ApiError("invalid_passage");
    }

    const now = deps.now();
    const result = afterContribution(loaded.state, now, {
      contributorPosition: me.position,
      turnVersion: body.turnVersion,
    });
    if (!result.ok) {
      throw new ApiError(result.reason);
    }

    const saved = await appendContribution(c.env.DB, {
      storyId,
      loadedVersion: loaded.state.turnVersion,
      next: result.state,
      contribution: { id: newId(), participantId: me.id, text: passage.value, createdAt: now },
    });
    if (!saved) {
      throw new ApiError("stale_turn");
    }
    await notifyRoom(c, storyId, result.state.turnVersion);

    return c.body(null, 204);
  });

  routes.post("/api/stories/:id/skip", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const body = await parseJsonBody(c, skipRequestSchema);
    const loaded = await requireStory(c, storyId);
    const me = await requireParticipant(c, loaded);

    const result = skip(loaded.state, deps.now(), {
      skipperPosition: me.position,
      turnVersion: body.turnVersion,
    });
    if (!result.ok) {
      throw new ApiError(result.reason);
    }

    const saved = await saveTurn(c.env.DB, storyId, loaded.state.turnVersion, result.state);
    if (!saved) {
      throw new ApiError("stale_turn");
    }
    await notifyRoom(c, storyId, result.state.turnVersion);

    return c.body(null, 204);
  });

  // Same checks as reading the story, so a socket never hears about a story its browser can't read.
  routes.get("/api/stories/:id/live", async (c) => {
    if (c.req.header("Upgrade") !== "websocket") {
      return c.text("Expected a WebSocket upgrade", 426);
    }
    requireSameOrigin(c);

    const storyId = parseStoryId(c.req.param("id"));
    const loaded = await requireStory(c, storyId);
    await requireParticipant(c, loaded);

    return c.env.STORY_ROOM.getByName(storyId).fetch(c.req.raw);
  });

  return routes;
}

// Retries with a new ID on a collision, one attempt at a time.
async function createUnderFreeId(
  db: Db,
  newStoryId: () => string,
  attemptsLeft: number,
  input: (storyId: string) => CreateStoryInput,
): Promise<string> {
  if (attemptsLeft === 0) {
    throw new Error("No free story ID");
  }

  const storyId = newStoryId();
  if (await createStory(db, input(storyId))) {
    return storyId;
  }

  return createUnderFreeId(db, newStoryId, attemptsLeft - 1, input);
}

// An ID that can't be a story ID is an unknown story.
function parseStoryId(raw: string): string {
  const storyId = normaliseStoryId(raw);
  if (storyId === null) {
    throw new ApiError("not_found");
  }

  return storyId;
}

async function requireStory(c: AppContext, storyId: string): Promise<LoadedStory> {
  const loaded = await loadStory(c.env.DB, storyId);
  if (loaded === null) {
    throw new ApiError("not_found");
  }

  return loaded;
}

// The caller is the participant whose token hash matches the cookie's.
async function requireParticipant(c: AppContext, loaded: LoadedStory): Promise<ParticipantRow> {
  const hash = await hashBrowserToken(readBrowserToken(c));
  const me = loaded.participants.find((p) => p.browserTokenHash === hash);
  if (me === undefined) {
    throw new ApiError("not_participant");
  }

  return me;
}
