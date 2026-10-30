/** Largest request body the API accepts, checked before any parsing. */
export const MAX_BODY_BYTES = 8 * 1024;

export const BROWSER_TOKEN_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** Fresh story IDs to try before giving up; a collision is rare, so several in a row is a bug. */
export const STORY_ID_ATTEMPTS = 5;
