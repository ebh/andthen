import type { AppContext } from "./http";

/**
 * Tells the story's StoryRoom that the story changed, so it can push the new turn version to
 * every open socket. Returns at once: the call runs under `waitUntil`, so a slow or hung room
 * can't delay a write that is already committed. A failure is logged and swallowed, since
 * clients still catch up on their next refetch or reconnect.
 */
export function notifyRoom(c: AppContext, storyId: string, turnVersion: number): void {
  c.executionCtx.waitUntil(sendNotification(c.env.STORY_ROOM, storyId, turnVersion));
}

async function sendNotification(
  rooms: Env["STORY_ROOM"],
  storyId: string,
  turnVersion: number,
): Promise<void> {
  try {
    await rooms.getByName(storyId).notify({ version: turnVersion });
  } catch (error) {
    console.error("StoryRoom notify failed", error);
  }
}
