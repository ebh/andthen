import { DurableObject } from "cloudflare:workers";

/** Holds one story's live WebSocket connections. Stub until Phase 4 adds broadcasts. */
export class StoryRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so idle sockets stay hibernated.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override fetch(): Response {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }
}
