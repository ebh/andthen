import { Link } from "expo-router";
import { Anchor, H2, Paragraph, YStack, useMedia } from "tamagui";

import { describeTimeLeft } from "../client/format";
import { useNow } from "../client/useNow";
import type { StorySummary } from "../shared/api";

interface MyStoriesProps {
  /** The stories to list, in the order to show them. */
  stories: readonly StorySummary[];
}

const CLOCK_TICK_MS = 10_000;

/** The stories this browser is in, each a link to its page, with whose turn it is. */
export function MyStories({ stories }: MyStoriesProps) {
  const now = useNow(CLOCK_TICK_MS);
  const media = useMedia();

  return (
    <YStack role="region" aria-label="Your stories" gap={media.md ? "10" : "6"}>
      <H2
        fontFamily="story"
        fontSize={media.md ? "5xl" : "3xl"}
        lineHeight={media.md ? "5xl" : "3xl"}
        fontWeight="600"
      >
        Your stories
      </H2>
      <YStack role="list" borderTopWidth={1} borderColor="base-300">
        {stories.map((story) => (
          <YStack key={story.id} role="listitem" borderBottomWidth={1} borderColor="base-300">
            <Link href={`/${story.id}`} asChild>
              <Anchor display="flex" flexDirection="column" gap="1" py="4">
                <Paragraph
                  fontFamily="story"
                  fontSize={media.md ? "2xl" : "lg"}
                  lineHeight={media.md ? "2xl" : "lg"}
                  numberOfLines={2}
                >
                  {story.opening}
                </Paragraph>
                <Paragraph
                  fontSize="sm"
                  lineHeight="sm"
                  color={story.isMyTurn ? "primary" : "muted"}
                  fontWeight={story.isMyTurn ? "600" : "400"}
                >
                  {describeStatus(story, now)}
                </Paragraph>
              </Anchor>
            </Link>
          </YStack>
        ))}
      </YStack>
    </YStack>
  );
}

function describeStatus(story: StorySummary, now: number): string {
  if (story.holderName === null || story.endsAt === null) {
    return "Waiting for someone to join";
  }
  if (story.isMyTurn) {
    return `Your turn · ${describeTimeLeft(story.endsAt, now)}`;
  }

  return `${story.holderName}’s turn · ${story.writerCount.toString()} writers`;
}
