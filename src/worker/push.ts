import { buildPushPayload } from "@block65/webcrypto-web-push";

import type { TurnPushPayload } from "../shared/api";
import { parseVapidConfig, type VapidConfig } from "./config";
import type { PushSubscriptionRow } from "./db/pushRepo";

/**
 * What a push service did with a message. `gone` means the subscription no longer exists (404 or
 * 410), so the caller deletes it. `failed` is anything else; the subscription is kept, because
 * a push service that is down or rejects one message says nothing about the next.
 */
export type PushOutcome = "delivered" | "gone" | "failed";

/** The declarative Web Push shape; `turnPushPayloadSchema` is the contract with the service worker. */
export type PushData = TurnPushPayload;

export interface PushMessage {
  data: PushData;
  /** A push service keeps only the newest undelivered message with the same topic. */
  topic: string;
  /** How long the push service may hold the message for an offline browser. */
  ttlSeconds: number;
}

export interface PushSender {
  /** Never throws: a failure is logged and answered as `failed`. */
  send: (subscription: PushSubscriptionRow, message: PushMessage) => Promise<PushOutcome>;
}

export interface WebPushSenderOptions {
  vapid: VapidConfig;
  fetch: typeof fetch;
}

const senders = new WeakMap<object, PushSender>();

/** The sender for this `env`. Parses the VAPID keys once per `env`; a missing or bad key throws. */
export function selectPushSender(env: object): PushSender {
  const known = senders.get(env);
  if (known !== undefined) {
    return known;
  }

  const sender = createWebPushSender({
    vapid: parseVapidConfig(env),
    fetch: (input, init) => fetch(input, init),
  });
  senders.set(env, sender);

  return sender;
}

/** Encrypts each message for its browser (RFC 8291), signs it with VAPID (RFC 8292) and posts it. */
export function createWebPushSender({ vapid, fetch: post }: WebPushSenderOptions): PushSender {
  return {
    send: async (subscription, message) => {
      try {
        const request = await buildPushPayload(
          {
            data: message.data,
            options: { ttl: message.ttlSeconds, topic: message.topic, urgency: "high" },
          },
          {
            endpoint: subscription.endpoint,
            expirationTime: null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          vapid,
        );
        const response = await post(subscription.endpoint, request);

        return outcomeOf(response, subscription.endpoint);
      } catch (error) {
        console.error(`Push to ${hostOf(subscription.endpoint)} threw`, error);
        return "failed";
      }
    },
  };
}

function outcomeOf(response: Response, endpoint: string): PushOutcome {
  if (response.ok) {
    return "delivered";
  }
  if (response.status === 404 || response.status === 410) {
    return "gone";
  }

  console.error(`Push to ${hostOf(endpoint)} answered ${String(response.status)}`);
  return "failed";
}

// An endpoint is a capability URL, so the log names only the push service.
function hostOf(endpoint: string): string {
  return new URL(endpoint).host;
}
