import { getCookie, setCookie } from "hono/cookie";

import { DEVICE_TOKEN_HEADER, deviceTokenSchema } from "../shared/deviceToken";
import { BROWSER_TOKEN_MAX_AGE_SECONDS } from "./config";
import { ApiError, type AppContext } from "./http";

interface CookieSettings {
  name: string;
  secure: boolean;
}

/**
 * The device token a request carries, or null when it carries none. The `X-Device-Token` header
 * decides alone: a client that sends it never has its cookie read, because a native HTTP client
 * may keep a cookie store of its own. A header that is present but malformed, an empty one
 * included, is `bad_request`, so it can't pass for "no token". Without the header the cookie
 * decides.
 */
export function readDeviceToken(c: AppContext): string | null {
  const header = c.req.header(DEVICE_TOKEN_HEADER);
  if (header !== undefined) {
    const parsed = deviceTokenSchema.safeParse(header);
    if (!parsed.success) {
      throw new ApiError("bad_request");
    }

    return parsed.data;
  }

  const cookie = getCookie(c, cookieSettings(c.req.url).name);

  return cookie === undefined || cookie === "" ? null : cookie;
}

/**
 * The request's device token. A request with none gets a new one in a `Set-Cookie` header, so
 * only a request without the header can be given a cookie.
 */
export function readOrIssueDeviceToken(c: AppContext): string {
  const existing = readDeviceToken(c);
  if (existing !== null) {
    return existing;
  }

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const { name, secure } = cookieSettings(c.req.url);
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: BROWSER_TOKEN_MAX_AGE_SECONDS,
  });

  return token;
}

/** Only the hash is stored, so a leaked database can't be used to act as a participant. */
export async function hashBrowserToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));

  return toHex(new Uint8Array(digest));
}

/**
 * `__Host-` pins the cookie to this host over HTTPS. WebKit drops it over plain HTTP, so
 * `http://localhost` (dev) gets a plain cookie without `Secure`.
 */
function cookieSettings(requestUrl: string): CookieSettings {
  const { protocol, hostname } = new URL(requestUrl);

  return protocol === "http:" && hostname === "localhost"
    ? { name: "andthen_bt", secure: false }
    : { name: "__Host-andthen_bt", secure: true };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
