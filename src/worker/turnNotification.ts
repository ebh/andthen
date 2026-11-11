import type { PushMessage } from "./push";

export interface TurnNotificationInput {
  storyId: string;
  /**
   * The story's first passage in full; the notification quotes its start. Null when the person
   * notified has blocked its author: the notification then quotes nothing.
   */
  opening: string | null;
  /** The app's origin, such as `https://app.andthen.page`, so the tap opens the story. */
  origin: string;
  now: number;
  /** When the new holder's turn expires, in epoch milliseconds. */
  turnEndsAt: number;
}

/** A push service may drop a message with a shorter life before it reaches a sleeping phone. */
export const MIN_PUSH_TTL_SECONDS = 60;

/** The longest opening quoted in a notification, in characters as a reader counts them. */
export const MAX_EXCERPT_LENGTH = 60;

// Same granularity as validation.ts: one user-perceived character, so an emoji counts as 1.
const graphemes = new Intl.Segmenter("en");

/**
 * The "your turn" message for a story. It stays useful until the turn expires, so it lives that
 * long at the push service; after that the next holder's message replaces it (same topic).
 */
export function turnNotification(input: TurnNotificationInput): PushMessage {
  const { storyId, opening, origin, now, turnEndsAt } = input;
  const topic = `turn-${storyId}`;

  return {
    data: {
      web_push: 8030,
      notification: {
        title: "Your turn",
        body: opening === null ? "" : excerpt(opening),
        navigate: `${origin}/${storyId}`,
        tag: topic,
      },
    },
    topic,
    ttlSeconds: Math.max(MIN_PUSH_TTL_SECONDS, Math.ceil((turnEndsAt - now) / 1000)),
  };
}

/**
 * The start of a passage, at most MAX_EXCERPT_LENGTH characters, cut at a word and ended with an
 * ellipsis when it is shortened. Runs of whitespace, newlines included, become one space.
 */
export function excerpt(text: string): string {
  const flat = text.trim().replaceAll(/\s+/g, " ");
  const characters = Array.from(graphemes.segment(flat), ({ segment }) => segment);
  if (characters.length <= MAX_EXCERPT_LENGTH) {
    return flat;
  }

  const head = characters.slice(0, MAX_EXCERPT_LENGTH).join("");
  const endsAtWordBoundary = characters[MAX_EXCERPT_LENGTH] === " ";
  const lastSpace = head.lastIndexOf(" ");
  const cut = endsAtWordBoundary || lastSpace <= 0 ? head : head.slice(0, lastSpace);

  return `${cut.trimEnd()}…`;
}
