const RSA_ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  // Clerk's PEM loader strips a fixed 2048-bit key prefix, so any other size fails to verify.
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
} as const;

const testKeyPair = await generateKeyPair();
const otherKeyPair = await generateKeyPair();

/** The public half of the key `signSessionToken` signs with, as Clerk's dashboard shows it. */
export const TEST_JWT_KEY = await exportPublicKeyPem(testKeyPair);

export interface SessionTokenOptions {
  /** Seconds until `exp` from now; negative makes an expired token. 60 by default. */
  expiresInSeconds?: number;
  /** Signs with a key `TEST_JWT_KEY` does not match. */
  signWithOtherKey?: boolean;
}

/**
 * A session token for `clerkUserId` that `selectSessionVerifier` accepts when its env carries
 * `TEST_JWT_KEY` and the request goes to `origin`.
 */
export async function signSessionToken(
  clerkUserId: string,
  origin: string,
  options: SessionTokenOptions = {},
): Promise<string> {
  const { expiresInSeconds = 60, signWithOtherKey = false } = options;
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "ins_test" };
  const payload = {
    sub: clerkUserId,
    azp: origin,
    iss: "https://clerk.test",
    iat: issuedAt,
    nbf: issuedAt - 5,
    exp: issuedAt + expiresInSeconds,
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const { privateKey } = signWithOtherKey ? otherKeyPair : testKeyPair;
  const signature = await crypto.subtle.sign(
    RSA_ALGORITHM.name,
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  const generated = await crypto.subtle.generateKey(RSA_ALGORITHM, true, ["sign", "verify"]);
  if (!("privateKey" in generated)) {
    throw new Error("Expected a key pair");
  }

  return generated;
}

async function exportPublicKeyPem({ publicKey }: CryptoKeyPair): Promise<string> {
  const exported = await crypto.subtle.exportKey("spki", publicKey);
  if (!(exported instanceof ArrayBuffer)) {
    throw new Error("Expected DER bytes");
  }
  const lines = btoa(String.fromCharCode(...new Uint8Array(exported))).match(/.{1,64}/g) ?? [];

  return ["-----BEGIN PUBLIC KEY-----", ...lines, "-----END PUBLIC KEY-----"].join("\n");
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
