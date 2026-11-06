export interface VapidKeyPair {
  /** The raw uncompressed P-256 point, 65 bytes, base64url. Safe to publish. */
  publicKey: string;
  /** The private scalar `d` of the key's JWK, 32 bytes, base64url. A secret. */
  privateKey: string;
}

/** A new key pair in the form the Worker's VAPID settings take (`parseVapidConfig`). */
export async function generateVapidKeys(): Promise<VapidKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  if (!("privateKey" in pair)) {
    throw new Error("Generating an ECDSA key did not give a key pair");
  }
  const publicPoint = await crypto.subtle.exportKey("raw", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  // The Workers typings give both calls the union of every export format.
  if (!(publicPoint instanceof ArrayBuffer)) {
    throw new Error("The exported public key is not raw bytes");
  }
  if (privateJwk instanceof ArrayBuffer || privateJwk.d === undefined) {
    throw new Error("The exported private key is not a JWK with d");
  }

  return { publicKey: toBase64Url(new Uint8Array(publicPoint)), privateKey: privateJwk.d };
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
