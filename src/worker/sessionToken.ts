import { verifyToken } from "@clerk/backend";
import { z } from "zod";

export type SessionVerdict =
  | { type: "valid"; clerkUserId: string }
  /** `reason` is for the server log only; it never reaches the client. */
  | { type: "rejected"; reason: string };

/** Checks one session token against the origin the request was made to. Never throws. */
export type SessionVerifier = (token: string, origin: string) => Promise<SessionVerdict>;

const claimsSchema = z.object({ sub: z.string().min(1) });

/**
 * A verifier for this request's bindings. It checks the signature against `CLERK_JWT_KEY`, so it
 * makes no network call, and accepts only a token issued for `origin` (its `azp` claim).
 */
export function selectSessionVerifier(env: Env): SessionVerifier {
  return async (token, origin) => {
    try {
      const claims = await verifyToken(token, {
        jwtKey: env.CLERK_JWT_KEY,
        authorizedParties: [origin],
      });

      return { type: "valid", clerkUserId: claimsSchema.parse(claims).sub };
    } catch (error) {
      return { type: "rejected", reason: error instanceof Error ? error.message : "unknown" };
    }
  };
}
