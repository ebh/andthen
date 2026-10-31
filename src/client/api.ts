import { z } from "zod";

import {
  createStoryResponseSchema,
  errorCodeSchema,
  joinResponseSchema,
  storyViewSchema,
  suggestionsResponseSchema,
  type CreateStoryRequest,
  type CreateStoryResponse,
  type JoinRequest,
  type JoinResponse,
  type StoryView,
  type SuggestionsResponse,
} from "../shared/api";

// `story_full` (joining a full story) comes from a server change that may land before the shared
// schema lists it. Accepting it here keeps that error from reading as "unreadable" meanwhile.
const clientErrorCodeSchema = z.union([errorCodeSchema, z.literal("story_full")]);
const errorBodySchema = z.object({ error: clientErrorCodeSchema });
export type ClientErrorCode = z.infer<typeof clientErrorCodeSchema>;

export type ApiFailure =
  | { type: "network" }
  // A success status whose body isn't the documented shape, or an error status whose body isn't
  // an error code (a proxy's HTML page, say).
  | { type: "unreadable"; status: number }
  | { type: "rejected"; status: number; code: ClientErrorCode };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

export function createStory(request: CreateStoryRequest): Promise<ApiResult<CreateStoryResponse>> {
  return call("/api/stories", postJson(request), createStoryResponseSchema);
}

export function fetchStory(storyId: string): Promise<ApiResult<StoryView>> {
  return call(storyPath(storyId), { method: "GET" }, storyViewSchema);
}

export function joinStory(storyId: string, request: JoinRequest): Promise<ApiResult<JoinResponse>> {
  return call(`${storyPath(storyId)}/participants`, postJson(request), joinResponseSchema);
}

export function contribute(
  storyId: string,
  request: { text: string; turnVersion: number },
): Promise<ApiResult<null>> {
  return call(`${storyPath(storyId)}/contributions`, postJson(request), noBodySchema);
}

export function skipTurn(storyId: string, turnVersion: number): Promise<ApiResult<null>> {
  return call(`${storyPath(storyId)}/skip`, postJson({ turnVersion }), noBodySchema);
}

export function requestSuggestions(storyId: string): Promise<ApiResult<SuggestionsResponse>> {
  return call(`${storyPath(storyId)}/suggestions`, postJson({}), suggestionsResponseSchema);
}

// Mutating routes answer 204, so reading the body fails and yields null.
const noBodySchema = z.null();

async function call<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    // fetch rejects with a TypeError when the network fails; anything else is a bug here.
    if (error instanceof TypeError) {
      return { ok: false, failure: { type: "network" } };
    }
    throw error;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = errorBodySchema.safeParse(body);

    return error.success
      ? {
          ok: false,
          failure: { type: "rejected", status: response.status, code: error.data.error },
        }
      : { ok: false, failure: { type: "unreadable", status: response.status } };
  }

  const parsed = schema.safeParse(body);

  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failure: { type: "unreadable", status: response.status } };
}

function storyPath(storyId: string): string {
  return `/api/stories/${storyId}`;
}

function postJson(body: object): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
