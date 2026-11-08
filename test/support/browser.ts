import type { Hono } from "hono";
import {
  createStoryResponseSchema,
  errorBodySchema,
  joinResponseSchema,
  storyViewSchema,
  type StoryView,
} from "../../src/shared/api";
import { API_LEVEL, API_LEVEL_HEADER } from "../../src/shared/apiLevel";
import { DEVICE_TOKEN_HEADER } from "../../src/shared/deviceToken";
import { createApp } from "../../src/worker/app";
import type { PushSender } from "../../src/worker/push";
import { selectSessionVerifier } from "../../src/worker/sessionToken";
import { fakeProvider } from "../../src/worker/suggestions/fake";
import type { SuggestionProvider } from "../../src/worker/suggestions/provider";
import { createFakePushSender } from "./fakePushSender";

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
  /** The X-Api-Level header value; the current API_LEVEL by default. `null` sends none. */
  apiLevel?: string | null;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

export interface GetOptions {
  /** Extra request headers, such as `Upgrade` and `Origin` for a WebSocket handshake. */
  headers?: Record<string, string>;
  /** Bindings to run against, instead of the ones the browser was made with. */
  env?: object;
  /** The X-Api-Level header value; the current API_LEVEL by default. `null` sends none. */
  apiLevel?: string | null;
}

/** A browser with its own cookie jar, talking to the app in-process. */
export interface Browser {
  get: (path: string, options?: GetOptions) => Promise<Response>;
  post: (path: string, body?: unknown, options?: RequestOptions) => Promise<Response>;
  put: (path: string, body?: unknown, options?: RequestOptions) => Promise<Response>;
  delete: (path: string, body?: unknown, options?: RequestOptions) => Promise<Response>;
  /** Sent as `Authorization: Bearer` on every request while set; null sends none. */
  sessionToken: string | null;
  /** Sent as `X-Device-Token` on every request while set; null sends none. */
  deviceToken: string | null;
  /** Raw cookie values by name. */
  cookies: Map<string, string>;
  /** Promises the app passed to `waitUntil`, in order. A hung one stays pending forever. */
  backgroundWork: Promise<unknown>[];
}

export function createTestApp(
  clock: Clock,
  newStoryId?: () => string,
  suggestionProvider: SuggestionProvider = fakeProvider,
  minApiLevel?: number,
  pushSender: PushSender = createFakePushSender(),
): TestApp {
  let counter = 0;

  return createApp({
    now: () => clock.now,
    newStoryId:
      newStoryId ??
      (() => {
        counter += 1;
        return counter.toString(36).padStart(5, "0");
      }),
    suggestionProvider: () => suggestionProvider,
    pushSender: () => pushSender,
    sessionVerifier: selectSessionVerifier,
    minApiLevel,
  });
}

export function createBrowser(app: TestApp, env: Env, origin = "http://localhost"): Browser {
  const cookies = new Map<string, string>();
  const background: Promise<unknown>[] = [];
  const executionCtx = fakeExecutionContext((promise) => {
    background.push(promise);
  });

  const send = async (
    path: string,
    init: RequestInit,
    options: { env?: object | undefined; apiLevel?: string | null | undefined },
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    const apiLevel = options.apiLevel === undefined ? String(API_LEVEL) : options.apiLevel;
    if (apiLevel !== null) {
      headers.set(API_LEVEL_HEADER, apiLevel);
    }
    if (browser.sessionToken !== null && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${browser.sessionToken}`);
    }
    if (browser.deviceToken !== null) {
      headers.set(DEVICE_TOKEN_HEADER, browser.deviceToken);
    }
    if (cookies.size > 0) {
      headers.set("Cookie", Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; "));
    }

    const response = await app.request(
      `${origin}${path}`,
      { ...init, headers },
      options.env ?? env,
      executionCtx,
    );
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair = ""] = setCookie.split(";");
      const [name = "", value = ""] = pair.split("=");
      cookies.set(name, value);
    }

    return response;
  };

  const sendWithBody =
    (method: string): Browser["post"] =>
    (path, body, options = {}) => {
      const headers = new Headers(options.headers);
      const sentOrigin = options.origin === undefined ? origin : options.origin;
      if (sentOrigin !== null) {
        headers.set("Origin", sentOrigin);
      }
      const contentType =
        options.contentType === undefined ? "application/json" : options.contentType;
      if (contentType !== null) {
        headers.set("Content-Type", contentType);
      }

      // A DELETE given neither a body nor a raw body sends none, as a real client does.
      const sendsBody = method !== "DELETE" || body !== undefined || options.rawBody !== undefined;

      return send(
        path,
        {
          method,
          headers,
          body: sendsBody
            ? new TextEncoder().encode(options.rawBody ?? JSON.stringify(body))
            : null,
        },
        options,
      );
    };

  const browser: Browser = {
    sessionToken: null,
    deviceToken: null,
    cookies,
    backgroundWork: background,
    get: (path, options = {}) => send(path, { headers: options.headers ?? {} }, options),
    post: sendWithBody("POST"),
    put: sendWithBody("PUT"),
    delete: sendWithBody("DELETE"),
  };

  return browser;
}

/**
 * A store app: it sends `X-Device-Token` and no `Origin`, and has no cookie jar, so every
 * `Set-Cookie` is dropped. A test asserts on the response when it wants to know one was sent.
 */
export function createPhone(app: TestApp, env: Env, deviceToken = newDeviceToken()): Browser {
  const phone = createBrowser(app, env);
  phone.deviceToken = deviceToken;

  const withoutCookies =
    <Args extends unknown[]>(call: (...args: Args) => Promise<Response>) =>
    async (...args: Args): Promise<Response> => {
      const response = await call(...args);
      phone.cookies.clear();

      return response;
    };

  const { get, post, put, delete: del } = phone;
  phone.get = withoutCookies(get);
  phone.post = withoutCookies((path, body, options) => post(path, body, noOrigin(options)));
  phone.put = withoutCookies((path, body, options) => put(path, body, noOrigin(options)));
  phone.delete = withoutCookies((path, body, options) => del(path, body, noOrigin(options)));

  return phone;
}

// A write sends no Origin unless the test asks for one.
function noOrigin(options: RequestOptions = {}): RequestOptions {
  return { origin: null, ...options };
}

/** A device token of the shape a client generates: 64 lowercase hex characters. */
export function newDeviceToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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

// Only `waitUntil` is real. Hono reads nothing else, and building the rest of the Workers
// ExecutionContext (exports, tracing) would mean stubbing the runtime.
function fakeExecutionContext(waitUntil: (promise: Promise<unknown>) => void): ExecutionContext {
  // oxlint-disable-next-line typescript/no-unsafe-return -- the partial context is the point
  return Object.assign(Object.create(null), { waitUntil });
}
