let leftStoryPending = false;

/** Notes that the writer just left a story, for the landing page to say so once. */
export function setLeftStoryNote(): void {
  leftStoryPending = true;
}

/** Whether a story was just left. It forgets the note: only the first call after `setLeftStoryNote` says yes. */
export function takeLeftStoryNote(): boolean {
  const pending = leftStoryPending;
  leftStoryPending = false;

  return pending;
}
