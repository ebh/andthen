import { parseSuggestions } from "./parse";
import { buildMessages, type ChatMessage } from "./prompt";
import type { SuggestionResult } from "./provider";

/** One model call. Returns the raw output, or null when the model gave nothing usable. */
export type CompleteChat = (messages: ChatMessage[]) => Promise<unknown>;

const ATTEMPTS = 2;

/**
 * Asks the model and parses the answer. Output that doesn't parse is asked for again once; a
 * thrown error (model error, quota) is not retried, since a second call would hit the same wall.
 * After `signal` aborts no further call starts: an abandoned request must not spend more.
 */
export async function generateSuggestions(
  complete: CompleteChat,
  storyText: string,
  signal?: AbortSignal,
): Promise<SuggestionResult> {
  try {
    return await attempt(complete, buildMessages(storyText), ATTEMPTS, signal);
  } catch (error) {
    console.error("Suggestion provider failed", error);
    return { ok: false, failure: "model_error" };
  }
}

async function attempt(
  complete: CompleteChat,
  messages: ChatMessage[],
  attemptsLeft: number,
  signal: AbortSignal | undefined,
): Promise<SuggestionResult> {
  if (signal?.aborted === true) {
    return { ok: false, failure: "timed_out" };
  }
  if (attemptsLeft === 0) {
    return { ok: false, failure: "unusable_output" };
  }

  const suggestions = parseSuggestions(await complete(messages));
  if (suggestions !== null) {
    return { ok: true, suggestions };
  }

  return attempt(complete, messages, attemptsLeft - 1, signal);
}
