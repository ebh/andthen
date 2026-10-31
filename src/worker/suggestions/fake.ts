import type { SuggestionProvider, Suggestions } from "./provider";

export const FAKE_SUGGESTIONS: Suggestions = [
  "A door creaked somewhere behind them, and nobody dared to turn around.",
  "Suddenly the lights went out, and a small voice began to laugh.",
  "By morning, the map in her pocket had changed again.",
];

/** Local dev, tests and e2e: fixed suggestions, no network and no Cloudflare login. */
export const fakeProvider: SuggestionProvider = {
  suggest: () => Promise.resolve({ ok: true, suggestions: FAKE_SUGGESTIONS }),
};
