import type { Hono } from "hono";
import {
  createStoryResponseSchema,
  errorBodySchema,
  joinResponseSchema,
  storyViewSchema,
  type StoryView,
} from "../../src/shared/api";
import { createApp } from "../../src/worker/app";

export const T0 = 1_700_000_000_000;

export interface Clock {
  now: number;
}

type TestApp = Hono<{ Bindings: Env }>;

export interface RequestOptions {
  /** The Origin header; the browser's own origin by default. `null` sends none. */
  origin?: string | null;
  /** The Content-Type header; `application/json` by default. `null` sends none. */
  contentType?: string | null;
  /** A body sent as is, instead of `body` as JSON. */
  rawBody?: string;
  /** Bindings to run against, instead of the ones the browser was made with. */
  env?: object;
}

/** A browser with its own cookie jar, talking to the app in-process. */
export interface Browser {
  get: (path: string) => Promise<Response>;
  post: (path: string, body?: unknown, options?: RequestOptions) => Promise<Response>;
  /** Raw cookie values by name. */
  cookies: Map<string, string>;
}

export function createTestApp(clock: Clock, newStoryId?: () => string): TestApp {
  let counter = 0;

  return createApp({
    now: () => clock.now,
    newStoryId:
      newStoryId ??
      (() => {
        counter += 1;
        return counter.toString(36).padStart(5, "0");
      }),
  });
}

export function createBrowser(app: TestApp, env: Env, origin = "http://localhost"): Browser {
  const cookies = new Map<string, string>();

  const send = async (path: string, init: RequestInit, extra?: object): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set("Cookie", Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; "));
    }

    const response = await app.request(`${origin}${path}`, { ...init, headers }, extra ?? env);
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair = ""] = setCookie.split(";");
      const [name = "", value = ""] = pair.split("=");
      cookies.set(name, value);
    }

    return response;
  };

  return {
    cookies,
    get: (path) => send(path, {}),
    post: (path, body, options = {}) => {
      const headers = new Headers();
      const sentOrigin = options.origin === undefined ? origin : options.origin;
      if (sentOrigin !== null) {
        headers.set("Origin", sentOrigin);
      }
      const contentType =
        options.contentType === undefined ? "application/json" : options.contentType;
      if (contentType !== null) {
        headers.set("Content-Type", contentType);
      }

      return send(
        path,
        {
          method: "POST",
          headers,
          body: new TextEncoder().encode(options.rawBody ?? JSON.stringify(body)),
        },
        options.env,
      );
    },
  };
}

/** Creates a story as `browser` and returns its ID. */
export async function createStory(
  browser: Browser,
  displayName = "Ana",
  opening = "Once upon a time.",
): Promise<string> {
  const response = await browser.post("/api/stories", { displayName, opening });
  expectStatus(response, 201);

  return createStoryResponseSchema.parse(await response.json()).storyId;
}

export async function readStory(browser: Browser, storyId: string): Promise<StoryView> {
  const response = await browser.get(`/api/stories/${storyId}`);
  expectStatus(response, 200);

  return storyViewSchema.parse(await response.json());
}

export async function readError(response: Response): Promise<string> {
  return errorBodySchema.parse(await response.json()).error;
}

export async function joinStory(
  browser: Browser,
  storyId: string,
  displayName: string,
): Promise<string> {
  const response = await browser.post(`/api/stories/${storyId}/participants`, { displayName });
  expectStatus(response, 201);

  return joinResponseSchema.parse(await response.json()).participantId;
}

function expectStatus(response: Response, status: number): void {
  if (response.status !== status) {
    throw new Error(`Expected ${String(status)}, got ${String(response.status)}`);
  }
}
