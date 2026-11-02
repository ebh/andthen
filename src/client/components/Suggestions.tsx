import { useState } from "react";

import { requestSuggestions } from "../api";
import { describeFailure } from "../messages";

type SuggestionsState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "shown"; suggestions: readonly string[] }
  | { type: "failed"; message: string };

interface SuggestionsControl {
  state: SuggestionsState;
  ask: () => void;
}

/**
 * Holder-only. Asks the server for three continuations, only when `ask` is called, never
 * automatically. The button and the list are separate components so the page can place them apart;
 * both take the one control this returns.
 */
export function useSuggestions(storyId: string, onTurnLost: () => void): SuggestionsControl {
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

  return { state, ask };
}

export function SuggestButton({ control }: { control: SuggestionsControl }) {
  return (
    <button
      type="button"
      className="btn btn-secondary min-h-11 grow sm:grow-0"
      disabled={control.state.type === "loading"}
      onClick={control.ask}
    >
      {control.state.type === "loading" ? "Thinking…" : "Suggest continuations"}
    </button>
  );
}

interface SuggestionListProps {
  control: SuggestionsControl;
  /** Receives the chosen text. The parent puts it in the composer; nothing is submitted. */
  onUse: (text: string) => void;
}

export function SuggestionList({ control, onUse }: SuggestionListProps) {
  const { state } = control;

  return (
    <section aria-label="Suggestions" className="flex flex-col gap-2">
      <div role="status" aria-live="polite">
        {state.type === "failed" && <p className="text-warning">{state.message}</p>}
      </div>
      {state.type === "shown" && (
        <ul className="flex flex-col gap-2">
          {state.suggestions.map((suggestion, index) => (
            <li key={`${index.toString()}:${suggestion}`}>
              <button
                type="button"
                className="btn btn-outline h-auto min-h-11 w-full justify-start py-2 text-left font-normal whitespace-pre-wrap normal-case"
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
