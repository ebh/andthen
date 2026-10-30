const STORY_ID_PATTERN = /^[a-z0-9]{5}$/;

/** Lowercases a story ID from a URL; returns null when it isn't a valid ID. */
export function normaliseStoryId(raw: string): string | null {
  const id = raw.toLowerCase();

  return STORY_ID_PATTERN.test(id) ? id : null;
}
