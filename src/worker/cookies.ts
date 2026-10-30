import { getCookie, setCookie } from "hono/cookie";

import { BROWSER_TOKEN_MAX_AGE_SECONDS } from "./config";
import type { AppContext } from "./http";

interface CookieSettings {
  name: string;
  secure: boolean;
}

/** The browser's secret from its cookie; empty when it has none, which matches no participant. */
export function readBrowserToken(c: AppContext): string {
  return getCookie(c, cookieSettings(c.req.url).name) ?? "";
}

/** The browser's secret; a browser with none gets a new one in a `Set-Cookie` header. */
export function readOrIssueBrowserToken(c: AppContext): string {
  const existing = readBrowserToken(c);
  if (existing !== "") {
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
