import { describe, expect, it } from "vitest";

import {
  signSessionToken,
  TEST_JWT_KEY,
  type SessionTokenOptions,
} from "../../test/support/sessionToken";
import { selectSessionVerifier } from "./sessionToken";

const ORIGIN = "http://localhost";

describe("the session verifier", () => {
  const verify = selectSessionVerifier({ CLERK_JWT_KEY: TEST_JWT_KEY });

  it("returns the Clerk user id of a valid token", async () => {
    const verdict = await verify(await signSessionToken("user_verified", ORIGIN), ORIGIN);

    expect(verdict).toEqual({ type: "valid", clerkUserId: "user_verified" });
  });

  it("rejects with a reason for the server log and never throws", async () => {
    const verdict = await verify(await signSessionToken("user_x", "https://evil.example"), ORIGIN);

    expect(verdict.type).toBe("rejected");
    expect(verdict.type === "rejected" ? verdict.reason.trim() : "").not.toBe("");
  });

  // Clerk checks `azp` only when present, so a token without one would skip the origin check.
  it.each<[string, SessionTokenOptions]>([
    ["has no azp claim", { omitAuthorizedParty: true }],
    ["has expired", { expiresInSeconds: -120 }],
    ["is signed with another key", { signWithOtherKey: true }],
  ])("rejects a token that %s", async (_name, options) => {
    const verdict = await verify(await signSessionToken("user_x", ORIGIN, options), ORIGIN);

    expect(verdict.type).toBe("rejected");
  });

  it("rejects a token that is not a JWT", async () => {
    const verdict = await verify("not-a-jwt", ORIGIN);

    expect(verdict.type).toBe("rejected");
  });

  it("rejects every token when the key is not a public key", async () => {
    const badKey = selectSessionVerifier({ CLERK_JWT_KEY: "not-a-public-key" });

    const verdict = await badKey(await signSessionToken("user_x", ORIGIN), ORIGIN);

    expect(verdict.type).toBe("rejected");
  });
});
