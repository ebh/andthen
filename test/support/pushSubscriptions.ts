import { z } from "zod";

import { pushSubscriptionIdOf } from "../../src/shared/pushSubscriptionId";
import type { Browser } from "./browser";

const PUSH_SUBSCRIPTIONS = "/api/push-subscriptions";

const bodyWithEndpointSchema = z.object({ endpoint: z.string() });

type Options = Parameters<Browser["put"]>[2];

/**
 * PUTs `body` at the path its endpoint names. A body with no endpoint goes to the path of the empty
 * endpoint, so a test of a bad body still reaches the body check.
 */
export async function putPushSubscription(
  browser: Browser,
  body: unknown,
  options?: Options,
): Promise<Response> {
  const parsed = bodyWithEndpointSchema.safeParse(body);
  const endpoint = parsed.success ? parsed.data.endpoint : "";

  return browser.put(
    `${PUSH_SUBSCRIPTIONS}/${await pushSubscriptionIdOf(endpoint)}`,
    body,
    options,
  );
}

/** DELETEs the subscription at `endpoint`, with no body. */
export async function deletePushSubscription(
  browser: Browser,
  endpoint: string,
  options?: Options,
): Promise<Response> {
  return browser.delete(
    `${PUSH_SUBSCRIPTIONS}/${await pushSubscriptionIdOf(endpoint)}`,
    undefined,
    options,
  );
}
