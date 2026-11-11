import { Hono } from "hono";

import {
  blockUserRequestSchema,
  type BlocksResponse,
  type BlockUserResponse,
} from "../../shared/api";
import { createBlock, deleteBlock, listBlocks } from "../db/blockRepo";
import type { UserRow } from "../db/rows";
import { findUserById } from "../db/userRepo";
import { ApiError, parseJsonBody, type AppContext } from "../http";
import { newId } from "../ids";
import { resolveMe, type MeDeps } from "../me";

export function blockRoutes(deps: MeDeps): Hono<{ Bindings: Env }> {
  const routes = new Hono<{ Bindings: Env }>();

  // Only reads: a request with no user has no blocks.
  routes.get("/api/users/me/blocks", async (c) => {
    const me = await resolveMe(c, deps);
    const response: BlocksResponse = {
      blocks: me === null ? [] : await listBlocks(c.env.DB, me.id),
    };

    return c.json(response);
  });

  routes.post("/api/users/me/blocks", async (c) => {
    const body = await parseJsonBody(c, blockUserRequestSchema);
    const me = await requireMe(c, deps);
    if (body.blockedUserId === me.id) {
      throw new ApiError("cannot_block_self");
    }
    if ((await findUserById(c.env.DB, body.blockedUserId)) === null) {
      throw new ApiError("not_found");
    }

    const { id: blockId, created } = await createBlock(c.env.DB, {
      id: newId(),
      userId: me.id,
      blockedUserId: body.blockedUserId,
      createdAt: deps.now(),
    });
    const response: BlockUserResponse = { blockId };

    c.header("Location", `/api/users/me/blocks/${blockId}`);

    // A repeat is not a creation: it answers 200 with the existing block.
    return c.json(response, created ? 201 : 200);
  });

  routes.delete("/api/users/me/blocks/:blockId", async (c) => {
    const me = await requireMe(c, deps);
    if (!(await deleteBlock(c.env.DB, c.req.param("blockId"), me.id))) {
      throw new ApiError("not_found");
    }

    return c.body(null, 204);
  });

  return routes;
}

// A request with no user holds no blocks and can have seen no user to block, so it finds nothing.
async function requireMe(c: AppContext, deps: MeDeps): Promise<UserRow> {
  const me = await resolveMe(c, deps);
  if (me === null) {
    throw new ApiError("not_found");
  }

  return me;
}
