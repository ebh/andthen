import { Link } from "expo-router";
import { useState } from "react";
import { Anchor, Button, H2, Paragraph, XStack, YStack } from "tamagui";

import { rejoinStory } from "../client/api";
import { isOpeningObscured } from "../client/blocks";
import { describeFailure } from "../client/messages";
import { useBlocks } from "../client/useBlocks";
import { MAX_PARTICIPANTS } from "../shared/validation";
import { ObscuredPassage } from "./ObscuredPassage";

interface RejoinProps {
  storyId: string;
  /** The name the writer had in the story. */
  displayName: string;
  /** The story's first passage, to tell which story this is. */
  opening: string;
  /** The user ID of the opening's author: the user may have blocked them. Missing means unknown. */
  openingAuthorId?: string | undefined;
  /** Called after the server accepts the rejoin, or says the writer is already back in. */
  onRejoined: () => void;
}

/** What a browser that left the story sees at its address: one button to come back. */
export function Rejoin({
  storyId,
  displayName,
  opening,
  openingAuthorId,
  onRejoined,
}: RejoinProps) {
  const blocks = useBlocks();
  const [error, setError] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(false);
  const [full, setFull] = useState(false);

  const rejoin = (): void => {
    setRejoining(true);
    setError(null);
    void (async () => {
      const result = await rejoinStory(storyId);
      setRejoining(false);
      if (
        result.ok ||
        (result.failure.type === "rejected" && result.failure.code === "already_joined")
      ) {
        onRejoined();
        return;
      }
      // A full story stays full: retrying would only fail again.
      setFull(result.failure.type === "rejected" && result.failure.code === "story_full");
      setError(describeFailure(result.failure, FAILURE_MESSAGES));
    })();
  };

  return (
    <YStack gap="3" items="flex-start">
      <H2 fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600">
        You left this story
      </H2>
      <Paragraph fontFamily="story" fontSize="lg" lineHeight="lg" color="muted" numberOfLines={3}>
        {isOpeningObscured(blocks, openingAuthorId) ? (
          <ObscuredPassage
            text={opening}
            label="Opening passage, hidden because you blocked its author"
          />
        ) : (
          `“${opening}”`
        )}
      </Paragraph>
      <Paragraph>Rejoin as {displayName}. You’ll take the last place in the turn order.</Paragraph>
      <Paragraph role="alert" minH="6" color="error">
        {error}
      </Paragraph>
      <XStack flexWrap="wrap" items="center" gap="4">
        <Button size="xl" theme="brand" disabled={rejoining || full} onPress={rejoin}>
          {rejoining ? "Rejoining…" : `Rejoin as ${displayName}`}
        </Button>
        <Link href="/" asChild>
          <Anchor>← Your stories</Anchor>
        </Link>
      </XStack>
    </YStack>
  );
}

const FAILURE_MESSAGES = {
  story_full: `This story is full (${MAX_PARTICIPANTS.toString()} writers), so you can't rejoin it.`,
  stale_turn: "The story just changed. Try again.",
};
