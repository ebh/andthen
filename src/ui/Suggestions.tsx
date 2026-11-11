import { useState } from "react";
import { Button, Paragraph, YStack } from "tamagui";

import { requestSuggestions } from "../client/api";
import { suggestionsOutcome, type SuggestionsState } from "../client/suggestions";

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
      const outcome = suggestionsOutcome(result);
      if (outcome.turnLost) {
        onTurnLost();
      }
      setState(outcome.state);
    })();
  };

  return { state, ask };
}

export function SuggestButton({ control }: { control: SuggestionsControl }) {
  return (
    <Button
      size="xl"
      variant="outlined"
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
                variant="outlined"
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
