import { Link } from "expo-router";
import { Anchor, Button, Paragraph, XStack, YStack, useMedia } from "tamagui";

import type { StoryView } from "../shared/api";
import { InviteLink } from "./InviteLink";
import { Wordmark } from "./Wordmark";

interface StoryBoardProps {
  storyId: string;
  view: StoryView;
  /** True when the last reload failed; the story shown may be out of date. */
  refreshFailed: boolean;
  refetch: () => void;
}

/** A joined participant's page: the rail beside the story, with the invite link last. */
export function StoryBoard({ storyId, view, refreshFailed, refetch }: StoryBoardProps) {
  const media = useMedia();
  const invite = <InviteLink url={`${window.location.origin}/${storyId}`} />;
  const rail = (
    <YStack gap="2" items="flex-start">
      <Wordmark />
      <Link href="/" asChild>
        <Anchor>← Your stories</Anchor>
      </Link>
    </YStack>
  );
  const main = (
    <YStack flex={1} gap="4" items="flex-start">
      {refreshFailed && (
        <YStack role="status" gap="2" items="flex-start">
          <Paragraph>Couldn&apos;t refresh the story. What you see may be out of date.</Paragraph>
          <Button size="xl" onPress={refetch}>
            Retry
          </Button>
        </YStack>
      )}
      {view.turn.holderId === null && (
        <Paragraph>
          Nobody else has joined yet. Send them the invite link; the first person to join gets the
          next turn.
        </Paragraph>
      )}
    </YStack>
  );

  if (media.md) {
    return (
      <XStack bg="background" minH="100vh">
        <YStack w="72" p="8" justify="space-between" borderRightWidth={1} borderColor="base-300">
          {rail}
          {invite}
        </YStack>
        <YStack flex={1} p="8">
          {main}
        </YStack>
      </XStack>
    );
  }

  return (
    <YStack bg="background" minH="100vh" p="5" gap="8">
      {rail}
      {main}
      {invite}
    </YStack>
  );
}
