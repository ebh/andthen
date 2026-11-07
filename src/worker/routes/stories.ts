import { Hono } from "hono";

import {
  contributeRequestSchema,
  createStoryRequestSchema,
  emptyRequestSchema,
  joinRequestSchema,
  skipRequestSchema,
  type CreateStoryResponse,
  type JoinResponse,
  type MyStoriesResponse,
  type SuggestionsResponse,
} from "../../shared/api";
import { groupParagraphs } from "../../shared/paragraphs";
import {
  afterContribution,
  newStoryState,
  onJoin,
  onLeave,
  onRejoin,
  resolveTurn,
  skip,
} from "../../shared/turnOrder";
import {
  displayNameKey,
  MAX_PARTICIPANTS,
  normaliseStoryId,
  validateDisplayName,
  validatePassage,
} from "../../shared/validation";
import { STORY_ID_ATTEMPTS, SUGGESTION_LIMIT, SUGGESTION_WINDOW_MS } from "../config";
import type { ParticipantRow } from "../db/rows";
import { releaseSuggestion, reserveSuggestion } from "../db/suggestionRepo";
import {
  addParticipant,
  appendContribution,
  createStory,
  leaveStory,
  loadMyStories,
  loadOpeningText,
  loadStory,
  loadStoryWithContributions,
  rejoinStory,
  saveTurn,
  type CreateStoryInput,
  type Db,
  type LoadedStory,
} from "../db/storyRepo";
import {
  ApiError,
  LeftStoryError,
  parseJsonBody,
  requireSameOrigin,
  type AppContext,
} from "../http";
import { newId } from "../ids";
import { notifyRoom } from "../live";
import { requireOrCreateMe, resolveMe, type MeDeps } from "../me";
import type { PushSender } from "../push";
import { buildStoryView } from "../storyView";
import { summariseMyStories } from "../storySummaries";
import type { SuggestionProvider, SuggestionResult } from "../suggestions/provider";
import { notifyTurnHolder } from "../turnPush";

export interface StoryDeps extends MeDeps {
  /** A fresh story ID; called again after a collision. */
  newStoryId: () => string;
  /** The provider for this request's bindings; throws when the AI config is invalid. */
  suggestionProvider: (env: Env) => SuggestionProvider;
  /** The sender for this request's bindings; throws when the VAPID keys are missing or invalid. */
  pushSender: (env: Env) => PushSender;
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
    const user = await requireOrCreateMe(c, deps);
    const creator = {
      id: newId(),
      displayName: name.value,
      displayNameKey: displayNameKey(name.value),
      position: 0,
      userId: user.id,
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

  // Only reads: no cookie is issued or user created, and a browser without a user has no stories.
  routes.get("/api/stories", async (c) => {
    const me = await resolveMe(c, deps);
    const stories =
      me === null ? [] : summariseMyStories(await loadMyStories(c.env.DB, me.id), deps.now());
    const response: MyStoriesResponse = { stories };

    return c.json(response);
  });

  routes.get("/api/stories/:id", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const found = await loadStoryWithContributions(c.env.DB, storyId);
    if (found === null) {
      throw new ApiError("not_found");
    }
    const me = await requireParticipant(c, deps, found.loaded);

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

    const now = deps.now();
    const me = await requireOrCreateMe(c, deps);
    const key = displayNameKey(name.value);
    if (loaded.participants.some((p) => p.userId === me.id)) {
      throw new ApiError("already_joined");
    }
    if (loaded.participants.some((p) => p.displayNameKey === key)) {
      throw new ApiError("name_taken");
    }
    if (loaded.activeParticipants.length >= MAX_PARTICIPANTS) {
      throw new ApiError("story_full");
    }

    const joinedState = onJoin(loaded.state, loaded.nextPosition, now);
    const participant = {
      id: newId(),
      displayName: name.value,
      displayNameKey: key,
      position: loaded.nextPosition,
      userId: me.id,
    };
    const saved = await addParticipant(c.env.DB, {
      storyId,
      loadedVersion: loaded.state.turnVersion,
      next: joinedState,
      participant,
      joinedAt: now,
    });
    if (!saved) {
      throw await joinRefusal(c, storyId);
    }

    notifyRoom(c, storyId, joinedState);
    notifyTurnHolder(c, deps.pushSender, {
      storyId,
      loaded,
      saved: joinedState,
      requesterPosition: loaded.nextPosition,
      now,
    });

    const response: JoinResponse = { participantId: participant.id };
    return c.json(response, 201);
  });

  routes.post("/api/stories/:id/leave", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    await parseJsonBody(c, emptyRequestSchema);
    const loaded = await requireStory(c, storyId);
    const me = await requireParticipant(c, deps, loaded);

    const now = deps.now();
    const next = onLeave(loaded.state, me.position, now);
    const saved = await leaveStory(c.env.DB, {
      storyId,
      loadedVersion: loaded.state.turnVersion,
      next,
      participantId: me.id,
      leftAt: now,
    });
    if (!saved) {
      throw new ApiError("stale_turn");
    }

    notifyRoom(c, storyId, next);
    notifyTurnHolder(c, deps.pushSender, {
      storyId,
      loaded,
      saved: next,
      requesterPosition: me.position,
      now,
    });

    return c.body(null, 204);
  });

  routes.post("/api/stories/:id/rejoin", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    await parseJsonBody(c, emptyRequestSchema);
    const loaded = await requireStory(c, storyId);
    const me = await findParticipant(c, deps, loaded);
    if (me === undefined) {
      throw new ApiError("not_participant");
    }
    if (me.leftAt === null) {
      throw new ApiError("already_joined");
    }
    if (loaded.activeParticipants.length >= MAX_PARTICIPANTS) {
      throw new ApiError("story_full");
    }

    const now = deps.now();
    const next = onRejoin(
      loaded.state,
      { previousPosition: me.position, position: loaded.nextPosition },
      now,
    );
    const saved = await rejoinStory(c.env.DB, {
      storyId,
      loadedVersion: loaded.state.turnVersion,
      next,
      participantId: me.id,
      position: loaded.nextPosition,
    });
    if (!saved) {
      throw await joinRefusal(c, storyId);
    }

    notifyRoom(c, storyId, next);
    notifyTurnHolder(c, deps.pushSender, {
      storyId,
      loaded,
      saved: next,
      requesterPosition: loaded.nextPosition,
      now,
    });

    return c.body(null, 204);
  });

  routes.post("/api/stories/:id/contributions", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const body = await parseJsonBody(c, contributeRequestSchema);
    const loaded = await requireStory(c, storyId);
    const me = await requireParticipant(c, deps, loaded);
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
      contribution: {
        id: newId(),
        participantId: me.id,
        text: passage.value,
        startsParagraph: body.startsParagraph,
        createdAt: now,
      },
    });
    if (!saved) {
      throw new ApiError("stale_turn");
    }

    notifyRoom(c, storyId, result.state);
    notifyTurnHolder(c, deps.pushSender, {
      storyId,
      loaded,
      saved: result.state,
      requesterPosition: me.position,
      now,
    });

    return c.body(null, 204);
  });

  routes.post("/api/stories/:id/skip", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const body = await parseJsonBody(c, skipRequestSchema);
    const loaded = await requireStory(c, storyId);
    const me = await requireParticipant(c, deps, loaded);

    const now = deps.now();
    const result = skip(loaded.state, now, {
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

    notifyRoom(c, storyId, result.state);
    notifyTurnHolder(c, deps.pushSender, {
      storyId,
      loaded,
      saved: result.state,
      requesterPosition: me.position,
      now,
    });

    return c.body(null, 204);
  });

  // Reads the story and writes only the quota row: no text, no turn change, no version bump.
  routes.post("/api/stories/:id/suggestions", async (c) => {
    const storyId = parseStoryId(c.req.param("id"));
    const found = await loadStoryWithContributions(c.env.DB, storyId);
    if (found === null) {
      throw new ApiError("not_found");
    }
    const me = await requireParticipant(c, deps, found.loaded);

    // The stored holder may have timed out; only the resolved turn says who holds it now.
    const now = deps.now();
    if (resolveTurn(found.loaded.state, now).state.currentPosition !== me.position) {
      throw new ApiError("not_your_turn");
    }

    // Built before reserving, so a bad AI config fails the request without using up quota.
    const provider = deps.suggestionProvider(c.env);
    const request = { id: newId(), participantId: me.id, now };
    const reserved = await reserveSuggestion(c.env.DB, {
      ...request,
      windowMs: SUGGESTION_WINDOW_MS,
      limit: SUGGESTION_LIMIT,
    });
    if (!reserved) {
      throw new ApiError("ai_rate_limited");
    }

    const storyText = groupParagraphs(found.contributions)
      .map((paragraph) => paragraph.map(({ text }) => text).join(" "))
      .join("\n\n");
    const result = await askProvider(provider, storyText);
    if (!result.ok) {
      // Only an outage refunds: bad output and a timeout may already have been billed.
      if (result.failure === "model_error") {
        await releaseQuietly(c.env.DB, request.id);
      }
      throw new ApiError("ai_unavailable");
    }
    const response: SuggestionsResponse = { suggestions: result.suggestions };

    return c.json(response);
  });

  // Same checks as reading the story, so a socket never hears about a story its browser can't read.
  routes.get("/api/stories/:id/live", async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return c.text("Expected a WebSocket upgrade", 426);
    }
    requireSameOrigin(c);

    const storyId = parseStoryId(c.req.param("id"));
    const loaded = await requireStory(c, storyId);
    await requireParticipant(c, deps, loaded);

    return c.env.STORY_ROOM.getByName(storyId).fetch(c.req.raw);
  });

  return routes;
}

// A provider that throws breaks its contract; the quota slot still gets settled.
async function askProvider(
  provider: SuggestionProvider,
  storyText: string,
): Promise<SuggestionResult> {
  try {
    return await provider.suggest(storyText);
  } catch (error) {
    console.error("Suggestion provider threw", error);
    return { ok: false, failure: "model_error" };
  }
}

// If the refund itself fails the participant loses one slot for an hour; the 503 still goes out.
async function releaseQuietly(db: Db, id: string): Promise<void> {
  try {
    await releaseSuggestion(db, id);
  } catch (error) {
    console.error("Releasing a suggestion slot failed", error);
  }
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

// The write can't say why it was refused. A join that won the race may have taken the last place.
async function joinRefusal(c: AppContext, storyId: string): Promise<ApiError> {
  const current = await requireStory(c, storyId);

  return new ApiError(
    current.activeParticipants.length >= MAX_PARTICIPANTS ? "story_full" : "stale_turn",
  );
}

// The caller is the participant in the story who has not left, as the requesting user.
async function requireParticipant(
  c: AppContext,
  deps: MeDeps,
  loaded: LoadedStory,
): Promise<ParticipantRow> {
  const me = await findParticipant(c, deps, loaded);
  if (me === undefined) {
    throw new ApiError("not_participant");
  }
  if (me.leftAt !== null) {
    throw new LeftStoryError(me.displayName, await loadOpeningText(c.env.DB, loaded.story.id));
  }

  return me;
}

// The requesting user's participant row: the one who has not left, else the one that joined last.
// Positions only grow, so the highest position joined last.
async function findParticipant(
  c: AppContext,
  deps: MeDeps,
  loaded: LoadedStory,
): Promise<ParticipantRow | undefined> {
  const me = await resolveMe(c, deps);
  if (me === null) {
    return undefined;
  }

  const rows = loaded.participants.filter((p) => p.userId === me.id);

  return rows.find((p) => p.leftAt === null) ?? rows.at(-1);
}
