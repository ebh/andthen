import type { AppContext } from "./http";

/**
 * Tells the story's StoryRoom that the story changed, so it can push the new turn version to
 * every open socket. The write already succeeded in D1, so a failure here is logged and swallowed:
 * clients still catch up on their next refetch or reconnect.
 */
export async function notifyRoom(
  c: AppContext,
  storyId: string,
  turnVersion: number,
): Promise<void> {
  try {
    await c.env.STORY_ROOM.getByName(storyId).notify({ version: turnVersion });
  } catch (error) {
    console.error("StoryRoom notify failed", error);
  }
}
