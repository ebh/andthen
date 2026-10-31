import type { SuggestionProvider, SuggestionResult } from "./provider";

/**
 * Gives up on a provider that takes longer than `timeoutMs` and reports `timed_out`. The slow
 * call is not cancelled (the AI binding takes no abort signal) but the provider's `signal`
 * aborts, so it starts no retry; its late answer is dropped.
 */
export function withTimeout(provider: SuggestionProvider, timeoutMs: number): SuggestionProvider {
  return {
    suggest: async (storyText) => {
      const abandoned = new AbortController();
      const timer = Promise.withResolvers<SuggestionResult>();
      const timeoutId = setTimeout(() => {
        console.error("Suggestion provider timed out");
        abandoned.abort();
        timer.resolve({ ok: false, failure: "timed_out" });
      }, timeoutMs);

      try {
        return await Promise.race([provider.suggest(storyText, abandoned.signal), timer.promise]);
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
