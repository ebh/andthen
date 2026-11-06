import type { PushSubscriptionRow } from "../../src/worker/db/pushRepo";
import type { PushMessage, PushOutcome, PushSender } from "../../src/worker/push";

export interface SentPush {
  subscription: PushSubscriptionRow;
  message: PushMessage;
}

export interface FakePushSender extends PushSender {
  /** Every message sent, in order. */
  sent: SentPush[];
  /** What the push service answers for an endpoint; "delivered" when it isn't listed. */
  outcomes: Map<string, PushOutcome>;
  /** Endpoints whose send rejects, which a real sender never does. */
  throwing: Set<string>;
}

/** Stands in for the push service: records what would be sent and answers as scripted. */
export function createFakePushSender(): FakePushSender {
  const fake: FakePushSender = {
    sent: [],
    outcomes: new Map(),
    throwing: new Set(),
    send: (subscription, message) => {
      fake.sent.push({ subscription, message });
      if (fake.throwing.has(subscription.endpoint)) {
        return Promise.reject(new Error("push exploded"));
      }

      return Promise.resolve(fake.outcomes.get(subscription.endpoint) ?? "delivered");
    },
  };

  return fake;
}
