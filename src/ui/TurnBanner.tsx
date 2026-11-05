import { Button, Paragraph, YStack } from "tamagui";

import { describeTimeLeft } from "../client/format";
import { canSkipTurn, isMyTurn, turnHolder } from "../client/storyRules";
import type { StoryView } from "../shared/api";

interface TurnBannerProps {
  view: StoryView;
  now: number;
  skipping: boolean;
  onSkip: () => void;
}

/** Whose turn it is, how long is left, the rotation, and a skip button when the server would accept one. */
export function TurnBanner({ view, now, skipping, onSkip }: TurnBannerProps) {
  const holder = turnHolder(view);

  return (
    <YStack role="region" aria-label="Turn" gap="2" items="flex-start">
      {/* The only live region here: it changes when the turn moves, not every minute. */}
      <Paragraph
        role="status"
        fontFamily="story"
        fontSize="xl"
        lineHeight="xl"
        fontWeight="600"
        color={isMyTurn(view) ? "primary" : "color"}
      >
        {headline(view, holder?.displayName ?? null)}
      </Paragraph>
      {view.turn.endsAt !== null && (
        <Paragraph color="muted">{describeTimeLeft(view.turn.endsAt, now)}</Paragraph>
      )}
      <YStack role="list" aria-label="Turn order">
        {view.participants.map((participant) => (
          <Paragraph
            key={participant.id}
            role="listitem"
            fontWeight={participant.id === view.turn.holderId ? "600" : "400"}
            color={participant.id === view.turn.holderId ? "color" : "muted"}
          >
            {participant.displayName}
            {participant.id === view.me ? " (you)" : ""}
          </Paragraph>
        ))}
      </YStack>
      {canSkipTurn(view) && (
        <Button size="xl" disabled={skipping} onPress={onSkip}>
          {skipping ? "Skipping…" : `Skip ${holder?.displayName ?? "this turn"}`}
        </Button>
      )}
    </YStack>
  );
}

function headline(view: StoryView, holderName: string | null): string {
  if (holderName === null) {
    return "Waiting for someone to join";
  }

  return isMyTurn(view) ? "It's your turn" : `It's ${holderName}'s turn`;
}
