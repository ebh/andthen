import { describe, expect, it } from "vitest";

import {
  DEFAULT_AI_MODEL,
  parseAiConfig,
  parseVapidConfig,
  parseVapidPublicKey,
  SUGGESTION_LIMIT,
  SUGGESTION_TIMEOUT_MS,
  SUGGESTION_WINDOW_MS,
  VAPID_SUBJECT,
} from "./config";
import { generateVapidKeys } from "./vapidKeys";

describe("suggestion limits", () => {
  it("pins the agreed values: 3 requests per rolling hour", () => {
    expect(SUGGESTION_LIMIT).toBe(3);
    expect(SUGGESTION_WINDOW_MS).toBe(3_600_000);
    expect(SUGGESTION_TIMEOUT_MS).toBe(25_000);
  });
});

describe("parseAiConfig", () => {
  it("accepts each provider and defaults the model", () => {
    expect(parseAiConfig({ AI_PROVIDER: "fake" })).toEqual({
      AI_PROVIDER: "fake",
      AI_MODEL: DEFAULT_AI_MODEL,
    });
    expect(parseAiConfig({ AI_PROVIDER: "workers-ai", AI_MODEL: undefined }).AI_MODEL).toBe(
      DEFAULT_AI_MODEL,
    );
  });

  it("takes the model from AI_MODEL", () => {
    expect(parseAiConfig({ AI_PROVIDER: "workers-ai", AI_MODEL: "@cf/x/y" }).AI_MODEL).toBe(
      "@cf/x/y",
    );
  });

  it("fails fast, naming the variable, on a bad provider", () => {
    for (const bad of [undefined, "", "openai", "FAKE"]) {
      expect(() => parseAiConfig({ AI_PROVIDER: bad })).toThrow(
        /Invalid AI config[\s\S]*AI_PROVIDER/,
      );
    }
  });

  it("fails fast on an empty or non-string model", () => {
    for (const bad of ["", 3, null]) {
      expect(() => parseAiConfig({ AI_PROVIDER: "fake", AI_MODEL: bad })).toThrow(/AI_MODEL/);
    }
  });
});

describe("parseVapidPublicKey", () => {
  it("returns the public key and ignores the rest of the env", async () => {
    const { publicKey } = await generateVapidKeys();

    expect(parseVapidPublicKey({ VAPID_PUBLIC_KEY: publicKey, DB: {} })).toBe(publicKey);
  });

  it("fails fast, naming the variable, on a missing or malformed key", async () => {
    const { privateKey } = await generateVapidKeys();

    for (const bad of [undefined, "", "short", privateKey, 7]) {
      expect(() => parseVapidPublicKey({ VAPID_PUBLIC_KEY: bad })).toThrow(
        /Invalid VAPID config[\s\S]*VAPID_PUBLIC_KEY/,
      );
    }
  });
});

describe("parseVapidConfig", () => {
  it("returns the keys with the constant subject", async () => {
    const { publicKey, privateKey } = await generateVapidKeys();

    expect(
      parseVapidConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey }),
    ).toEqual({ subject: VAPID_SUBJECT, publicKey, privateKey });
    expect(VAPID_SUBJECT).toBe("https://andthen.page");
  });

  it("fails fast, naming the variable, when the private key is missing or malformed", async () => {
    const { publicKey, privateKey: valid } = await generateVapidKeys();

    for (const bad of [undefined, "", "short", publicKey, `${valid}A`]) {
      expect(() =>
        parseVapidConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: bad }),
      ).toThrow(/Invalid VAPID config[\s\S]*VAPID_PRIVATE_KEY/);
    }
  });

  it("does not put a malformed private key in the error", async () => {
    const { publicKey } = await generateVapidKeys();
    const secret = "not-a-key-but-secret";

    expect(() =>
      parseVapidConfig({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: secret }),
    ).toThrow(/^(?![\s\S]*not-a-key-but-secret)/);
  });

  it("fails fast on a bad public key too", async () => {
    const { privateKey } = await generateVapidKeys();

    expect(() =>
      parseVapidConfig({ VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: privateKey }),
    ).toThrow(/VAPID_PUBLIC_KEY/);
  });
});
