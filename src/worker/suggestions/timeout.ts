import type { SuggestionProvider } from "./provider";

/**
 * Gives up on a provider that takes longer than `timeoutMs` and reports failure. The slow call
 * is not cancelled (the AI binding takes no abort signal); its late answer is dropped.
 */
export function withTimeout(provider: SuggestionProvider, timeoutMs: number): SuggestionProvider {
  return {
    suggest: async (storyText) => {
      const timer = Promise.withResolvers<{ ok: false }>();
      const timeoutId = setTimeout(() => {
        console.error("Suggestion provider timed out");
        timer.resolve({ ok: false });
      }, timeoutMs);

      try {
        return await Promise.race([provider.suggest(storyText), timer.promise]);
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
