export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: ValidationFailure };

export type ValidationFailure = "empty" | "too_long";

export const MAX_PASSAGE_LENGTH = 280;
export const MAX_DISPLAY_NAME_LENGTH = 40;
export const TURN_WINDOW_MS = 24 * 60 * 60 * 1000;

// Checked before lowercasing: toLowerCase maps some non-ASCII letters (e.g. U+212A KELVIN SIGN)
// onto ASCII, which would let two different URLs alias one story.
const STORY_ID_PATTERN = /^[A-Za-z0-9]{5}$/;

// Grapheme is the default granularity: one user-perceived character, so an emoji counts as 1.
// The locale is fixed so the browser and the Worker count the same text the same way.
const graphemes = new Intl.Segmenter("en");

/** Trims a passage and checks it is 1 to MAX_PASSAGE_LENGTH graphemes long. */
export function validatePassage(raw: string): ValidationResult {
  return validateLength(raw, MAX_PASSAGE_LENGTH);
}

/** Trims a display name and checks it is 1 to MAX_DISPLAY_NAME_LENGTH graphemes long. */
export function validateDisplayName(raw: string): ValidationResult {
  return validateLength(raw, MAX_DISPLAY_NAME_LENGTH);
}

/**
 * The key that makes display names unique within a story, ignoring case.
 *
 * NFKC folds look-alike forms (composed vs decomposed accents, full-width letters).
 * Uppercasing before lowercasing folds characters with no single-letter lowercase pair,
 * so "ß" and "SS" collide.
 */
export function displayNameKey(name: string): string {
  return name.trim().normalize("NFKC").toUpperCase().toLowerCase();
}

/** Lowercases a story ID from a URL; returns null when it isn't a valid ID. */
export function normaliseStoryId(raw: string): string | null {
  return STORY_ID_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

function validateLength(raw: string, max: number): ValidationResult {
  const value = raw.trim();
  const length = Array.from(graphemes.segment(value)).length;

  if (length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (length > max) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, value };
}
