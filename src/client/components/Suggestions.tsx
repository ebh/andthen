import { useState } from "react";

import { requestSuggestions } from "../api";
import { describeFailure } from "../messages";

interface SuggestionsProps {
  storyId: string;
  /** Receives the chosen text. The parent puts it in the composer; nothing is submitted. */
  onUse: (text: string) => void;
  /** Called when the server says the turn is no longer ours, so the page can reload. */
  onTurnLost: () => void;
}

type SuggestionsState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "shown"; suggestions: readonly string[] }
  | { type: "failed"; message: string };

/** Holder-only. Asks the server for three continuations on an explicit click, never automatically. */
export function Suggestions({ storyId, onUse, onTurnLost }: SuggestionsProps) {
  const [state, setState] = useState<SuggestionsState>({ type: "idle" });

  const ask = (): void => {
    setState({ type: "loading" });
    void (async () => {
      const result = await requestSuggestions(storyId);
      if (result.ok) {
        setState({ type: "shown", suggestions: result.value.suggestions });
        return;
      }
      if (result.failure.type === "rejected" && result.failure.code === "not_your_turn") {
        onTurnLost();
      }
      setState({ type: "failed", message: describeFailure(result.failure, FAILURE_MESSAGES) });
    })();
  };

  return (
    <section aria-label="Suggestions" className="flex flex-col gap-2">
      <button
        type="button"
        className="btn btn-secondary btn-sm self-start"
        disabled={state.type === "loading"}
        onClick={ask}
      >
        {state.type === "loading" ? "Thinking…" : "Suggest continuations"}
      </button>
      <div role="status" aria-live="polite">
        {state.type === "failed" && <p className="text-warning">{state.message}</p>}
      </div>
      {state.type === "shown" && (
        <ul className="flex flex-col gap-2">
          {state.suggestions.map((suggestion, index) => (
            <li key={`${index.toString()}:${suggestion}`}>
              <button
                type="button"
                className="btn btn-outline h-auto w-full justify-start py-2 text-left font-normal whitespace-pre-wrap normal-case"
                onClick={() => {
                  onUse(suggestion);
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const FAILURE_MESSAGES = {
  ai_rate_limited:
    "You've used your suggestions for this hour. Try again later, or write your own passage.",
  ai_unavailable: "Suggestions aren't available right now. You can still write your own passage.",
  not_your_turn: "It's no longer your turn.",
};
