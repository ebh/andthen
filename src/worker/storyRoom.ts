import { DurableObject } from "cloudflare:workers";

import type { LiveMessage } from "../shared/api";

/**
 * Holds one story's live WebSocket connections and nothing else: the story stays in D1. The
 * Worker calls `notify` after each write, and the room tells every socket to refetch.
 */
export class StoryRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so idle sockets stay hibernated.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Only the Worker can reach this: browsers get `fetch` (the upgrade) and nothing more. */
  notify(message: LiveMessage): void {
    const text = JSON.stringify(message);

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(text);
      } catch {
        // A socket that is already closing must not stop the others hearing the message.
      }
    }
  }

  override fetch(): Response {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Clients only listen. Without a handler, a message would be logged as an error.
  override webSocketMessage(): void {}
}
