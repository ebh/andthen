import { describe, expect, it } from "vitest";

import { browserTokenCookie, deviceTokenFrom, hashBrowserToken } from "./cookies";
import { ApiError } from "./http";

const TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);

describe("deviceTokenFrom", () => {
  it.each([
    { name: "a valid header", header: TOKEN, cookie: undefined, expected: TOKEN },
    {
      name: "a header and a cookie naming another token",
      header: TOKEN,
      cookie: OTHER_TOKEN,
      expected: TOKEN,
    },
    { name: "only a cookie", header: undefined, cookie: OTHER_TOKEN, expected: OTHER_TOKEN },
    { name: "an empty cookie", header: undefined, cookie: "", expected: null },
    { name: "nothing", header: undefined, cookie: undefined, expected: null },
  ])("returns the right token for $name", ({ header, cookie, expected }) => {
    expect(deviceTokenFrom({ header, cookie })).toBe(expected);
  });

  it.each([
    { name: "a malformed header", header: "not-a-token" },
    { name: "an empty header", header: "" },
  ])("answers bad_request to $name, even beside a valid cookie", ({ header }) => {
    expect(() => deviceTokenFrom({ header, cookie: OTHER_TOKEN })).toThrow(
      new ApiError("bad_request"),
    );
  });
});

describe("browserTokenCookie", () => {
  const secureCookie = `__Host-andthen_bt=${TOKEN}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`;

  it.each([
    {
      name: "http://localhost gets a plain cookie without Secure",
      url: "http://localhost/api/stories",
      expected: `andthen_bt=${TOKEN}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`,
    },
    {
      name: "https on the app host gets a __Host- Secure cookie",
      url: "https://app.andthen.page/api/stories",
      expected: secureCookie,
    },
    {
      name: "http on another host gets a __Host- Secure cookie",
      url: "http://example.test/api/stories",
      expected: secureCookie,
    },
    {
      name: "https on localhost gets a __Host- Secure cookie",
      url: "https://localhost/api/stories",
      expected: secureCookie,
    },
  ])("$name", ({ url, expected }) => {
    expect(browserTokenCookie(TOKEN, url)).toBe(expected);
  });
});

describe("hashBrowserToken", () => {
  it("is the SHA-256 of the token in hex", async () => {
    expect(await hashBrowserToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
