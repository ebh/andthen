import { afterEach, describe, expect, it, vi } from "vitest";

import type { PushSubscriptionRow } from "./db/rows";
import { createWebPushSender, selectPushSender, type PushMessage } from "./push";
import { generateVapidKeys } from "./vapidKeys";

const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ENDPOINT = "https://push.example.test/send/abc123";

const MESSAGE: PushMessage = {
  data: {
    web_push: 8030,
    notification: {
      title: "Your turn",
      body: "Once upon a time…",
      navigate: "https://app.andthen.page/abc12",
      tag: "turn-abc12",
    },
  },
  topic: "turn-abc12",
  ttlSeconds: 3600,
};

afterEach(() => {
  vi.restoreAllMocks();
});

// A browser's side of a subscription: a P-256 key pair and a 16-byte authentication secret.
async function subscriptionOf(endpoint = ENDPOINT): Promise<PushSubscriptionRow> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  if (!("publicKey" in pair)) {
    throw new Error("Expected a key pair");
  }
  const exported = await crypto.subtle.exportKey("raw", pair.publicKey);
  if (!(exported instanceof ArrayBuffer)) {
    throw new Error("Expected raw key bytes");
  }
  const point = Buffer.from(exported);

  return {
    endpoint,
    p256dh: point.toString("base64url"),
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url"),
  };
}

async function senderAnswering(status: number) {
  const vapid = { ...(await generateVapidKeys()), subject: "https://andthen.page" };
  const post = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));

  return { sender: createWebPushSender({ vapid, fetch: post }), post, vapid };
}

describe("createWebPushSender", () => {
  it("posts an encrypted, VAPID-signed message to the subscription's endpoint", async () => {
    const { sender, post, vapid } = await senderAnswering(201);

    const outcome = await sender.send(await subscriptionOf(), MESSAGE);

    expect(outcome).toBe("delivered");
    expect(post).toHaveBeenCalledTimes(1);
    const [endpoint, init] = post.mock.calls[0] ?? [];
    expect(endpoint).toBe(ENDPOINT);
    expect(init?.method?.toUpperCase()).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("ttl")).toBe("3600");
    expect(headers.get("topic")).toBe("turn-abc12");
    expect(headers.get("urgency")).toBe("high");
    expect(init?.body).toBeInstanceOf(Uint8Array);
    expect(init?.body instanceof Uint8Array && init.body.byteLength).toBeGreaterThan(0);
    expect(headers.get("authorization")).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(headers.get("authorization")).toContain(`k=${vapid.publicKey}`);
  });

  it("signs the VAPID token for the endpoint's origin and the app's subject", async () => {
    const { sender, post, vapid } = await senderAnswering(201);

    await sender.send(await subscriptionOf(), MESSAGE);

    const authorization = new Headers(post.mock.calls[0]?.[1]?.headers).get("authorization") ?? "";
    const token = /t=([^,]+)/.exec(authorization)?.[1] ?? "";
    const [header = "", claims = "", signature = ""] = token.split(".");
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({
      aud: "https://push.example.test",
      sub: "https://andthen.page",
    });
    const verifier = await crypto.subtle.importKey(
      "raw",
      Buffer.from(vapid.publicKey, "base64url"),
      ECDSA_P256,
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${header}.${claims}`);
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        verifier,
        Buffer.from(signature, "base64url"),
        signed,
      ),
    ).toBe(true);
  });

  it.each([404, 410])(
    "reports a subscription the push service answers %s for as gone",
    async (status) => {
      const { sender } = await senderAnswering(status);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect(await sender.send(await subscriptionOf(), MESSAGE)).toBe("gone");
      expect(error).not.toHaveBeenCalled();
    },
  );

  it.each([400, 401, 403, 413, 429, 500, 503])(
    "reports %s as failed and logs the push service, not the endpoint",
    async (status) => {
      const { sender } = await senderAnswering(status);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect(await sender.send(await subscriptionOf(), MESSAGE)).toBe("failed");
      expect(error).toHaveBeenCalledWith(`Push to push.example.test answered ${String(status)}`);
    },
  );

  it("reports a network error as failed, logged, and does not throw", async () => {
    const { sender, post } = await senderAnswering(201);
    post.mockRejectedValue(new Error("network down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await sender.send(await subscriptionOf(), MESSAGE)).toBe("failed");
    expect(error).toHaveBeenCalledWith("Push to push.example.test threw", expect.any(Error));
  });

  it("reports a subscription the library cannot encrypt for as failed", async () => {
    const { sender, post } = await senderAnswering(201);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...(await subscriptionOf()), p256dh: "AAAA" };

    expect(await sender.send(broken, MESSAGE)).toBe("failed");
    expect(post).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("rejects a plain-http endpoint before posting", async () => {
    const { sender, post } = await senderAnswering(201);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await sender.send(await subscriptionOf("http://push.example.test/x"), MESSAGE);

    expect(outcome).toBe("failed");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("selectPushSender", () => {
  it("builds the sender from the env's keys once per env", async () => {
    const env = await vapidEnv();

    expect(selectPushSender(env)).toBe(selectPushSender(env));
    expect(selectPushSender(env)).not.toBe(selectPushSender(await vapidEnv()));
  });

  it("fails fast, naming the variable, when the private key is missing", async () => {
    const { VAPID_PRIVATE_KEY: _unset, ...withoutPrivateKey } = await vapidEnv();

    expect(() => selectPushSender(withoutPrivateKey)).toThrow(/VAPID_PRIVATE_KEY/);
  });

  it("posts through the global fetch", async () => {
    const env = await vapidEnv();
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    const outcome = await selectPushSender(env).send(await subscriptionOf(), MESSAGE);

    expect(outcome).toBe("delivered");
    expect(globalFetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "post" }));
  });
});

async function vapidEnv() {
  const { publicKey, privateKey } = await generateVapidKeys();

  return { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey };
}
