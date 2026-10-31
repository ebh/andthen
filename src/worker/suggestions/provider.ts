/** Three distinct, non-empty continuations, each already cut to the passage length limit. */
export type Suggestions = [string, string, string];

/** `ok: false` covers every failure: a model error, a quota hit, or output that never parsed. */
export type SuggestionResult = { ok: true; suggestions: Suggestions } | { ok: false };

export interface SuggestionProvider {
  /** Never throws. Reads the story; writes nothing. */
  suggest: (storyText: string) => Promise<SuggestionResult>;
}
