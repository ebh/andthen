import { parseSuggestions } from "./parse";
import { buildMessages, type ChatMessage } from "./prompt";
import type { SuggestionResult } from "./provider";

/** One model call. Returns the raw output, or null when the model gave nothing usable. */
export type CompleteChat = (messages: ChatMessage[]) => Promise<unknown>;

const ATTEMPTS = 2;

/**
 * Asks the model and parses the answer. Output that doesn't parse is asked for again once; a
 * thrown error (model error, quota) is not retried, since a second call would hit the same wall.
 */
export async function generateSuggestions(
  complete: CompleteChat,
  storyText: string,
): Promise<SuggestionResult> {
  try {
    return await attempt(complete, buildMessages(storyText), ATTEMPTS);
  } catch (error) {
    console.error("Suggestion provider failed", error);
    return { ok: false };
  }
}

async function attempt(
  complete: CompleteChat,
  messages: ChatMessage[],
  attemptsLeft: number,
): Promise<SuggestionResult> {
  if (attemptsLeft === 0) {
    return { ok: false };
  }

  const suggestions = parseSuggestions(await complete(messages));
  if (suggestions !== null) {
    return { ok: true, suggestions };
  }

  return attempt(complete, messages, attemptsLeft - 1);
}
