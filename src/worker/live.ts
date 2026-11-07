import { LIVE_SUBPROTOCOL, readOfferedSubprotocols } from "../shared/liveSubprotocol";
import { turnEndsAt, type TurnState } from "../shared/turnOrder";
import type { AppContext } from "./http";

/** What a StoryRoom needs to time the story's turn out by itself. */
export interface RoomTimer {
  storyId: string;
  /** The app's origin, so a timeout push opens the story on the host that served it. */
  origin: string;
  /** When the saved turn expires, in epoch milliseconds, or null while the story waits. */
  deadline: number | null;
}

/**
 * Tells the story's StoryRoom that the story changed: it pushes the saved turn's version to every
 * open socket and resets its timeout alarm to the saved turn's deadline. Returns at once: the
 * call runs under `waitUntil`, so a slow or hung room can't delay a write that is already
 * committed. A failure is logged and swallowed, since clients still catch up on their next
 * refetch or reconnect.
 */
export function notifyRoom(c: AppContext, storyId: string, saved: TurnState): void {
  const timer: RoomTimer = {
    storyId,
    origin: new URL(c.req.url).origin,
    deadline: turnEndsAt(saved),
  };
  c.executionCtx.waitUntil(sendNotification(c.env.STORY_ROOM, saved.turnVersion, timer));
}

const SUBPROTOCOL_HEADER = "Sec-WebSocket-Protocol";

/**
 * The upgrade request as the story's room should see it. The room never needs the session token
 * that rode in the offered subprotocols, so it is cut from what the room is sent.
 */
export function upgradeRequestForRoom(request: Request): Request {
  const headers = new Headers(request.headers);
  if (readOfferedSubprotocols(headers.get(SUBPROTOCOL_HEADER)).offersLive) {
    headers.set(SUBPROTOCOL_HEADER, LIVE_SUBPROTOCOL);
  } else {
    headers.delete(SUBPROTOCOL_HEADER);
  }

  return new Request(request, { headers });
}

/**
 * Headers for the room's `101` answer. A browser closes a socket whose answer isn't one of the
 * subprotocols it offered, so a client that offered `LIVE_SUBPROTOCOL` gets exactly that back.
 */
export function upgradeResponseHeaders(request: Request): Headers {
  const headers = new Headers();
  if (readOfferedSubprotocols(request.headers.get(SUBPROTOCOL_HEADER)).offersLive) {
    headers.set(SUBPROTOCOL_HEADER, LIVE_SUBPROTOCOL);
  }

  return headers;
}

async function sendNotification(
  rooms: Env["STORY_ROOM"],
  turnVersion: number,
  timer: RoomTimer,
): Promise<void> {
  try {
    await rooms.getByName(timer.storyId).notify({ version: turnVersion }, timer);
  } catch (error) {
    console.error("StoryRoom notify failed", error);
  }
}
