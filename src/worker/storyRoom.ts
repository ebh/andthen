import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import type { LiveMessage } from "../shared/api";
import { upgradeResponseHeaders, type RoomTimer } from "./live";
import { selectPushSender } from "./push";
import { passTimedOutTurn } from "./turnTimeout";

const TIMER_KEY = "turnTimer";

// What `alarm` needs that the alarm itself can't carry: the story and the origin of the request
// that last armed it.
const storedTimerSchema = z.object({ storyId: z.string(), origin: z.string() });

/**
 * Holds one story's live WebSocket connections, and times its turn out with an alarm set to the
 * turn's deadline. The story stays in D1. The Worker calls `notify` after each write: the room
 * tells every socket to refetch and resets the alarm. When the alarm fires, `passTimedOutTurn`
 * saves and pushes the lapsed turn, and the room tells the sockets.
 */
export class StoryRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so idle sockets stay hibernated.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Only the Worker can reach this: browsers get `fetch` (the upgrade) and nothing more. */
  async notify(message: LiveMessage, timer: RoomTimer): Promise<void> {
    this.broadcast(message);

    if (timer.deadline === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.put(TIMER_KEY, { storyId: timer.storyId, origin: timer.origin });
    await this.ctx.storage.setAlarm(timer.deadline);
  }

  // A throw here makes the runtime retry the alarm. passTimedOutTurn is safe to repeat.
  override async alarm(): Promise<void> {
    const { storyId, origin } = storedTimerSchema.parse(await this.ctx.storage.get(TIMER_KEY));

    const outcome = await passTimedOutTurn(this.env.DB, () => selectPushSender(this.env), {
      storyId,
      origin,
      now: Date.now(),
    });

    if (outcome.newTurnVersion !== null) {
      this.broadcast({ version: outcome.newTurnVersion });
    }
    if (outcome.nextDeadline !== null) {
      await this.ctx.storage.setAlarm(outcome.nextDeadline);
    }
  }

  override fetch(request: Request): Response {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);

    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: upgradeResponseHeaders(request),
    });
  }

  // Clients only listen. Without a handler, a message would be logged as an error.
  override webSocketMessage(): void {}

  private broadcast(message: LiveMessage): void {
    const text = JSON.stringify(message);

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(text);
      } catch {
        // A socket that is already closing must not stop the others hearing the message.
      }
    }
  }
}
