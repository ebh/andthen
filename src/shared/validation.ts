export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: ValidationFailure };

export type ValidationFailure = "empty" | "too_long";

export type JoinRefusal = "already_joined" | "name_taken" | "story_full";

export interface JoinFacts {
  alreadyJoined: boolean;
  nameHeld: boolean;
  activeWriterCount: number;
}

export const MAX_PASSAGE_LENGTH = 280;
export const MAX_DISPLAY_NAME_LENGTH = 40;
/** Creator included. Anyone with the link can join, and each joiner can hold the turn for a day. */
export const MAX_PARTICIPANTS = 50;
/** How many of a user's stories one page of `GET /api/stories` holds when the request names no limit. */
export const MY_STORIES_DEFAULT_LIMIT = 20;
/** The most stories one page may ask for. */
export const MY_STORIES_MAX_LIMIT = 50;
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

/** How many graphemes validatePassage counts: the trimmed text. A live counter shows this. */
export function passageLength(raw: string): number {
  return countGraphemes(raw.trim());
}

/**
 * Trims text and cuts it to MAX_PASSAGE_LENGTH graphemes, for model output that may run long.
 * Returns "" when nothing is left; the caller decides what that means.
 */
export function truncatePassage(raw: string): string {
  const value = raw.trim();
  const parts = Array.from(graphemes.segment(value), ({ segment }) => segment);

  return parts.slice(0, MAX_PASSAGE_LENGTH).join("").trim();
}

/** Trims a display name and checks it is 1 to MAX_DISPLAY_NAME_LENGTH graphemes long. */
export function validateDisplayName(raw: string): ValidationResult {
  return validateLength(raw, MAX_DISPLAY_NAME_LENGTH);
}

/** What a request's display name means for the user making it. `value` is null for no change. */
export type DisplayNameChoice =
  | { ok: true; value: { displayName: string; displayNameKey: string } | null }
  | { ok: false; reason: "invalid_display_name" | "bad_request" };

/**
 * Decides what a request's display name means. A user has one name in every story, so a user with
 * none must send a valid one, and a user with one must not send any: sending one would read as a
 * rename, which rewrites their name on every old passage. `current` is the user's name, or null.
 */
export function chooseDisplayName(
  requested: string | undefined,
  current: string | null,
): DisplayNameChoice {
  if (current !== null) {
    return requested === undefined
      ? { ok: true, value: null }
      : { ok: false, reason: "bad_request" };
  }

  const name = validateDisplayName(requested ?? "");
  if (!name.ok) {
    return { ok: false, reason: "invalid_display_name" };
  }

  return {
    ok: true,
    value: { displayName: name.value, displayNameKey: displayNameKey(name.value) },
  };
}

/**
 * The key that makes display names unique across users, ignoring case.
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

/**
 * Why a join is refused before anything is written, or null when it may go ahead. The order is
 * already_joined, name_taken, story_full: a person already in the story, or whose name is taken,
 * hears that before hearing the story is full.
 */
export function joinRefusalBeforeWrite({
  alreadyJoined,
  nameHeld,
  activeWriterCount,
}: JoinFacts): JoinRefusal | null {
  if (alreadyJoined) {
    return "already_joined";
  }
  if (nameHeld) {
    return "name_taken";
  }
  if (activeWriterCount >= MAX_PARTICIPANTS) {
    return "story_full";
  }

  return null;
}

function validateLength(raw: string, max: number): ValidationResult {
  const value = raw.trim();
  const length = countGraphemes(value);

  if (length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (length > max) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, value };
}

function countGraphemes(value: string): number {
  return Array.from(graphemes.segment(value)).length;
}
