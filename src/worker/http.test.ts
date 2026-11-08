import { describe, expect, it } from "vitest";

import { isTrustedOrigin } from "./http";

describe("isTrustedOrigin", () => {
  const ownOrigin = "https://andthen.page";

  it.each([
    ["the request's own origin, with no credential", ownOrigin, false, true],
    ["the request's own origin, with a credential", ownOrigin, true, true],
    ["another origin, with no credential", "https://evil.example", false, false],
    ["another origin, with a credential", "https://evil.example", true, false],
    ["the origin 'null', with a credential", "null", true, false],
    ["an empty origin, with a credential", "", true, false],
    ["no origin, with a credential", undefined, true, true],
    ["no origin, with no credential", undefined, false, false],
  ])("for %s", (_name, origin, carriesCredential, expected) => {
    expect(isTrustedOrigin({ origin, ownOrigin, carriesCredential })).toBe(expected);
  });
});
