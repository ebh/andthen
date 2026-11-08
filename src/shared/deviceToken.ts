import { z } from "zod";

/**
 * The request header that carries a device token. The store apps send it because they have no
 * cookie jar to rely on; a browser's cookie carries the same secret.
 */
export const DEVICE_TOKEN_HEADER = "X-Device-Token";

/** What a client generates and keeps: 32 random bytes as 64 lowercase hex characters. */
export const deviceTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
