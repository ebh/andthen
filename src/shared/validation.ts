// Checked before lowercasing: toLowerCase maps some non-ASCII letters (e.g. U+212A KELVIN SIGN)
// onto ASCII, which would let two different URLs alias one story.
const STORY_ID_PATTERN = /^[A-Za-z0-9]{5}$/;

/** Lowercases a story ID from a URL; returns null when it isn't a valid ID. */
export function normaliseStoryId(raw: string): string | null {
  return STORY_ID_PATTERN.test(raw) ? raw.toLowerCase() : null;
}
