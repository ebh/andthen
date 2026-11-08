import { z } from "zod";

import { API_LEVEL, API_LEVEL_HEADER } from "../shared/apiLevel";
import {
  contributeResponseSchema,
  createStoryResponseSchema,
  errorBodySchema,
  errorCodeSchema,
  joinResponseSchema,
  myStoriesResponseSchema,
  pushKeyResponseSchema,
  storyViewSchema,
  suggestionsResponseSchema,
  type ContributeRequest,
  type ContributeResponse,
  type CreateStoryRequest,
  type CreateStoryResponse,
  type JoinRequest,
  type JoinResponse,
  type MyStoriesResponse,
  type PlainErrorCode,
  type PushKeyResponse,
  type PushSubscriptionRequest,
  type StoryView,
  type SuggestionsResponse,
} from "../shared/api";
import { pushSubscriptionIdOf } from "../shared/pushSubscriptionId";
import { setClientOutdated } from "./clientOutdated";
import { getSessionToken } from "./sessionToken";

export type ApiFailure =
  | { type: "network" }
  // A success status whose body isn't the documented shape, or an error status whose body isn't
  // an error code (a proxy's HTML page, say).
  | { type: "unreadable"; status: number }
  | { type: "rejected"; status: number; code: PlainErrorCode }
  // An error body whose code this build doesn't know, from a newer Worker.
  | { type: "unknown_code"; status: number; code: string }
  // 426: the Worker no longer accepts this build's API level, so the app must be reloaded.
  | { type: "client_outdated" }
  // 403 `left_story`: this browser was in the story and left it.
  | { type: "left_story"; displayName: string; opening: string };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

export function listMyStories(): Promise<ApiResult<MyStoriesResponse>> {
  return call("/api/stories", { method: "GET" }, myStoriesResponseSchema);
}

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
  request: ContributeRequest,
): Promise<ApiResult<ContributeResponse>> {
  return call(`${storyPath(storyId)}/contributions`, postJson(request), contributeResponseSchema);
}

export function skipTurn(storyId: string, turnVersion: number): Promise<ApiResult<null>> {
  return call(`${storyPath(storyId)}/skip`, postJson({ turnVersion }), noBodySchema);
}

export function leaveStory(storyId: string): Promise<ApiResult<null>> {
  return call(`${storyPath(storyId)}/leave`, postJson({}), noBodySchema);
}

export function rejoinStory(storyId: string): Promise<ApiResult<null>> {
  return call(`${storyPath(storyId)}/rejoin`, postJson({}), noBodySchema);
}

export function requestSuggestions(storyId: string): Promise<ApiResult<SuggestionsResponse>> {
  return call(`${storyPath(storyId)}/suggestions`, postJson({}), suggestionsResponseSchema);
}

export function fetchPushKey(): Promise<ApiResult<PushKeyResponse>> {
  return call("/api/push-key", { method: "GET" }, pushKeyResponseSchema);
}

export async function savePushSubscription(
  subscription: PushSubscriptionRequest,
): Promise<ApiResult<null>> {
  return call(
    await pushSubscriptionPath(subscription.endpoint),
    jsonRequest("PUT", subscription),
    noBodySchema,
  );
}

export async function removePushSubscription(endpoint: string): Promise<ApiResult<null>> {
  return call(await pushSubscriptionPath(endpoint), { method: "DELETE" }, noBodySchema);
}

/** Brings this device's stories into the signed-in account. Needs a session token; safe to repeat. */
export function requestAddDeviceUserToAccount(): Promise<ApiResult<null>> {
  return call("/api/users/me/account", jsonRequest("PUT", {}), noBodySchema);
}

// Mutating routes answer 204, so reading the body fails and yields null.
const noBodySchema = z.null();

const anyErrorBodySchema = z.object({ error: z.string() });

type Init = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

// A token that expired between being fetched and arriving is rejected once; a fresh one fixes it.
async function call<T>(path: string, init: Init, schema: z.ZodType<T>): Promise<ApiResult<T>> {
  const token = await getSessionToken();
  const result = await send(path, init, schema, token);
  if (token === null || !isRejectedSessionToken(result)) {
    return result;
  }

  const fresh = await getSessionToken({ fresh: true });

  return fresh === null ? result : send(path, init, schema, fresh);
}

function isRejectedSessionToken(result: ApiResult<unknown>): boolean {
  return (
    !result.ok &&
    result.failure.type === "rejected" &&
    result.failure.code === "invalid_session_token"
  );
}

async function send<T>(
  path: string,
  init: Init,
  schema: z.ZodType<T>,
  sessionToken: string | null,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...init.headers,
        [API_LEVEL_HEADER]: String(API_LEVEL),
        ...(sessionToken !== null && { Authorization: `Bearer ${sessionToken}` }),
      },
    });
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
    if (!error.success) {
      return { ok: false, failure: unrecognisedError(response.status, body) };
    }

    const { data } = error;
    if (data.error === "client_outdated") {
      setClientOutdated(true);

      return { ok: false, failure: { type: "client_outdated" } };
    }
    if (data.error === "left_story") {
      const { displayName, opening } = data;

      return { ok: false, failure: { type: "left_story", displayName, opening } };
    }

    return { ok: false, failure: { type: "rejected", status: response.status, code: data.error } };
  }

  const parsed = schema.safeParse(body);

  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failure: { type: "unreadable", status: response.status } };
}

function unrecognisedError(status: number, body: unknown): ApiFailure {
  const parsed = anyErrorBodySchema.safeParse(body);
  // A known code that failed errorBodySchema is a malformed body, not a newer Worker's code.
  if (!parsed.success || errorCodeSchema.safeParse(parsed.data.error).success) {
    return { type: "unreadable", status };
  }

  return { type: "unknown_code", status, code: parsed.data.error };
}

async function pushSubscriptionPath(endpoint: string): Promise<string> {
  return `/api/push-subscriptions/${await pushSubscriptionIdOf(endpoint)}`;
}

function storyPath(storyId: string): string {
  return `/api/stories/${storyId}`;
}

function postJson(body: object): Init {
  return jsonRequest("POST", body);
}

function jsonRequest(method: "POST" | "PUT" | "DELETE", body: object): Init {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
