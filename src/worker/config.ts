import { z } from "zod";

/** Largest request body the API accepts, checked before any parsing. */
export const MAX_BODY_BYTES = 8 * 1024;

export const BROWSER_TOKEN_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Fresh story IDs to try before giving up; a collision is rare, so several in a row is a bug. */
export const STORY_ID_ATTEMPTS = 5;

/** Suggestion requests one participant may make in any rolling SUGGESTION_WINDOW_MS. */
export const SUGGESTION_LIMIT = 3;

export const SUGGESTION_WINDOW_MS = 60 * 60 * 1000;

/** How long a request waits for the model, including its one retry. */
export const SUGGESTION_TIMEOUT_MS = 25_000;

/** Supports JSON-schema output (docs/spike-findings.md). Any model set in `AI_MODEL` must too. */
export const DEFAULT_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const aiConfigSchema = z.object({
  AI_PROVIDER: z.enum(["workers-ai", "fake"]),
  AI_MODEL: z.string().min(1).default(DEFAULT_AI_MODEL),
});

export type AiConfig = z.infer<typeof aiConfigSchema>;

/** Throws an error naming the bad variable, so a misconfigured deploy fails loudly. */
export function parseAiConfig(vars: { AI_PROVIDER: unknown; AI_MODEL?: unknown }): AiConfig {
  const parsed = aiConfigSchema.safeParse({
    AI_PROVIDER: vars.AI_PROVIDER,
    AI_MODEL: vars.AI_MODEL,
  });
  if (!parsed.success) {
    throw new Error(`Invalid AI config: ${z.prettifyError(parsed.error)}`);
  }

  return parsed.data;
}

/** Names the sender to a push service, which uses it to contact the app's operator (RFC 8292). */
export const VAPID_SUBJECT = "https://andthen.page";

// A P-256 public key is 65 bytes (87 base64url characters); a private scalar is 32 bytes (43).
const vapidPublicKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{87}$/, "expected 87 base64url characters");
const vapidPrivateKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "expected 43 base64url characters");

const vapidPublicConfigSchema = z.object({ VAPID_PUBLIC_KEY: vapidPublicKeySchema });
const vapidConfigSchema = vapidPublicConfigSchema.extend({
  VAPID_PRIVATE_KEY: vapidPrivateKeySchema,
});

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * The public VAPID key, for a route that only hands it to a browser. A plain var in
 * `wrangler.jsonc`. Throws an error naming the variable when it is missing or malformed.
 */
export function parseVapidPublicKey(env: object): string {
  const parsed = vapidPublicConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid VAPID config: ${z.prettifyError(parsed.error)}`);
  }

  return parsed.data.VAPID_PUBLIC_KEY;
}

/**
 * Both VAPID keys, to sign a push. The private key is a Worker secret, so the generated `Env`
 * type does not list it (`wrangler types` runs without secrets in CI): read it from the object,
 * not from a typed property. The error names the variable and never echoes a value.
 */
export function parseVapidConfig(env: object): VapidConfig {
  const parsed = vapidConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid VAPID config: ${z.prettifyError(parsed.error)}`);
  }

  return {
    subject: VAPID_SUBJECT,
    publicKey: parsed.data.VAPID_PUBLIC_KEY,
    privateKey: parsed.data.VAPID_PRIVATE_KEY,
  };
}
