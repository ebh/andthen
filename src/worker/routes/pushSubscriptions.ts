import { Hono } from "hono";

import {
  pushSubscriptionSchema,
  removePushSubscriptionRequestSchema,
  type PushKeyResponse,
} from "../../shared/api";
import { parseVapidPublicKey } from "../config";
import { hashBrowserToken, readBrowserToken } from "../cookies";
import { deletePushSubscription, savePushSubscription } from "../db/pushRepo";
import { ApiError, parseJsonBody } from "../http";

export interface PushSubscriptionDeps {
  /** The clock, in epoch milliseconds. */
  now: () => number;
}

export function pushSubscriptionRoutes(deps: PushSubscriptionDeps): Hono<{ Bindings: Env }> {
  const routes = new Hono<{ Bindings: Env }>();

  // Only reads the public key, so it works in an environment that has no private key yet.
  routes.get("/api/push-subscription/key", (c) => {
    const response: PushKeyResponse = { publicKey: parseVapidPublicKey(c.env) };

    return c.json(response);
  });

  // A browser with no cookie is in no story, so there is nothing to push to it. Every cookieless
  // browser would otherwise share the hash of the empty token.
  routes.put("/api/push-subscription", async (c) => {
    const body = await parseJsonBody(c, pushSubscriptionSchema);
    const token = readBrowserToken(c);
    if (token === "") {
      throw new ApiError("not_participant");
    }

    await savePushSubscription(c.env.DB, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      browserTokenHash: await hashBrowserToken(token),
      createdAt: deps.now(),
    });

    return c.body(null, 204);
  });

  // Removing what isn't there is not an error, so a client can unsubscribe without checking first.
  // That includes a browser with no cookie, which owns nothing.
  routes.delete("/api/push-subscription", async (c) => {
    const body = await parseJsonBody(c, removePushSubscriptionRequestSchema);
    const token = readBrowserToken(c);
    if (token !== "") {
      await deletePushSubscription(c.env.DB, await hashBrowserToken(token), body.endpoint);
    }

    return c.body(null, 204);
  });

  return routes;
}
