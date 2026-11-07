import { Hono } from "hono";

import {
  pushSubscriptionSchema,
  removePushSubscriptionRequestSchema,
  type PushKeyResponse,
} from "../../shared/api";
import { parseVapidPublicKey } from "../config";
import {
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  savePushSubscription,
} from "../db/pushRepo";
import { parseJsonBody } from "../http";
import { resolveMe, type MeDeps } from "../me";

export type PushSubscriptionDeps = MeDeps;

export function pushSubscriptionRoutes(deps: PushSubscriptionDeps): Hono<{ Bindings: Env }> {
  const routes = new Hono<{ Bindings: Env }>();

  // Only reads the public key, so it works in an environment that has no private key yet.
  routes.get("/api/push-subscription/key", (c) => {
    const response: PushKeyResponse = { publicKey: parseVapidPublicKey(c.env) };

    return c.json(response);
  });

  // The endpoint belongs to whoever sends it now, because holding it proves the request comes
  // from that browser. A browser with no user has nothing to be pushed, so it is answered as for a
  // save but its endpoint is dropped: a session that ended elsewhere stops pushing on the next
  // load. The client must wait for its session to load before it sends this.
  routes.put("/api/push-subscription", async (c) => {
    const body = await parseJsonBody(c, pushSubscriptionSchema);
    const me = await resolveMe(c, deps);
    if (me === null) {
      await deletePushSubscriptionByEndpoint(c.env.DB, body.endpoint);

      return c.body(null, 204);
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
    const me = await resolveMe(c, deps);
    if (me !== null) {
      await deletePushSubscription(c.env.DB, me.id, body.endpoint);
    }

    return c.body(null, 204);
  });

  return routes;
}
