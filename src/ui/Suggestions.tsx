import { useState } from "react";
import { Button, Paragraph, YStack } from "tamagui";

import { requestSuggestions } from "../client/api";
import { describeFailure } from "../client/messages";

type SuggestionsState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "shown"; suggestions: readonly string[] }
  | { type: "failed"; message: string };

interface SuggestionsControl {
  state: SuggestionsState;
  ask: () => void;
}

interface SuggestionListProps {
  control: SuggestionsControl;
  /** Receives the chosen text. The parent puts it in the composer; nothing is submitted. */
  onUse: (text: string) => void;
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
    <Button
      size="xl"
      variant="outlined"
      theme="transparent"
      disabled={control.state.type === "loading"}
      onPress={control.ask}
    >
      {control.state.type === "loading" ? "Thinking…" : "Suggest continuations"}
    </Button>
  );
}

export function SuggestionList({ control, onUse }: SuggestionListProps) {
  const { state } = control;

  return (
    <YStack role="region" aria-label="Suggestions" gap="2">
      <Paragraph role="status" color="error" minH="6">
        {state.type === "failed" && state.message}
      </Paragraph>
      {state.type === "shown" && (
        <YStack role="list" gap="2">
          {state.suggestions.map((suggestion, index) => (
            <YStack key={`${index.toString()}:${suggestion}`} role="listitem">
              <Button
                size="xl"
                onPress={() => {
                  onUse(suggestion);
                }}
              >
                {suggestion}
              </Button>
            </YStack>
          ))}
        </YStack>
      )}
    </YStack>
  );
}

const FAILURE_MESSAGES = {
  ai_rate_limited:
    "You've used your suggestions for this hour. Try again later, or write your own passage.",
  ai_unavailable: "Suggestions aren't available right now. You can still write your own passage.",
  not_your_turn: "It's no longer your turn.",
};
