import { Hono } from "hono";

import {
  pushSubscriptionSchema,
  removePushSubscriptionRequestSchema,
  type PushKeyResponse,
} from "../../shared/api";
import { parseVapidPublicKey } from "../config";
import { deletePushSubscription, savePushSubscription } from "../db/pushRepo";
import { ApiError, parseJsonBody } from "../http";
import { resolveMe } from "../me";

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

  // A browser with no user is in no story, so there is nothing to push to it.
  routes.put("/api/push-subscription", async (c) => {
    const body = await parseJsonBody(c, pushSubscriptionSchema);
    const me = await resolveMe(c);
    if (me === null) {
      throw new ApiError("not_participant");
    }

    await savePushSubscription(c.env.DB, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userId: me.id,
      createdAt: deps.now(),
    });

    return c.body(null, 204);
  });

  // Removing what isn't there is not an error, so a client can unsubscribe without checking first.
  // That includes a browser with no user, which owns nothing.
  routes.delete("/api/push-subscription", async (c) => {
    const body = await parseJsonBody(c, removePushSubscriptionRequestSchema);
    const me = await resolveMe(c);
    if (me !== null) {
      await deletePushSubscription(c.env.DB, me.id, body.endpoint);
    }

    return c.body(null, 204);
  });

  return routes;
}
