import { z } from "zod";

import { truncatePassage } from "../../shared/validation";
import type { Suggestions } from "./provider";

const outputSchema = z.object({ suggestions: z.tuple([z.string(), z.string(), z.string()]) });

/**
 * Turns raw model output (JSON text, or the object a JSON-mode model already parsed) into three
 * suggestions, or null. Each is trimmed and cut to the passage limit first; an empty one, or two
 * that are the same once cut, make the whole output unusable.
 */
export function parseSuggestions(raw: unknown): Suggestions | null {
  const output = outputSchema.safeParse(typeof raw === "string" ? parseJson(raw) : raw);
  if (!output.success) {
    return null;
  }

  const [first, second, third] = output.data.suggestions.map(truncatePassage);
  if (first === undefined || second === undefined || third === undefined) {
    return null;
  }

  const suggestions: Suggestions = [first, second, third];
  const keys = new Set(suggestions.map(sameSuggestionKey));
  if (suggestions.includes("") || keys.size !== suggestions.length) {
    return null;
  }

  return suggestions;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Case and Unicode-form differences don't make a suggestion distinct.
function sameSuggestionKey(suggestion: string): string {
  return suggestion.normalize("NFKC").toLowerCase();
}
