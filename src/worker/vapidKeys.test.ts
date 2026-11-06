import { describe, expect, it } from "vitest";

import { generateVapidKeys } from "./vapidKeys";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

describe("generateVapidKeys", () => {
  it("makes an uncompressed P-256 point and a 32-byte private scalar, both base64url", async () => {
    const { publicKey, privateKey } = await generateVapidKeys();

    expect(publicKey).toMatch(BASE64URL);
    expect(privateKey).toMatch(BASE64URL);
    const point = Buffer.from(publicKey, "base64url");
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(0x04);
    expect(Buffer.from(privateKey, "base64url")).toHaveLength(32);
  });

  it("makes a different pair each time", async () => {
    const [first, second] = await Promise.all([generateVapidKeys(), generateVapidKeys()]);

    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.privateKey).not.toBe(second.privateKey);
  });

  it("makes a private key that signs for its public key", async () => {
    const { publicKey, privateKey } = await generateVapidKeys();
    const point = Buffer.from(publicKey, "base64url");
    const signer = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33).toString("base64url"),
        d: privateKey,
      },
      ECDSA_P256,
      false,
      ["sign"],
    );
    const verifier = await crypto.subtle.importKey("raw", point, ECDSA_P256, false, ["verify"]);
    const message = new TextEncoder().encode("hello");

    const signature = await crypto.subtle.sign(ECDSA_SHA256, signer, message);

    expect(await crypto.subtle.verify(ECDSA_SHA256, verifier, signature, message)).toBe(true);
  });
});
