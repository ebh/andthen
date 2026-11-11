import { Link } from "expo-router";
import { Anchor, Button, H2, Paragraph, YStack, useMedia } from "tamagui";

import { describeStatus } from "../client/format";
import type { MoreStoriesStatus } from "../client/useMyStories";
import { useNow } from "../client/useNow";
import type { StorySummary } from "../shared/api";
import { Opening } from "./Opening";

interface MyStoriesProps {
  /** The stories to list, in the order to show them. */
  stories: readonly StorySummary[];
  /** Whether the list goes on past `stories`. */
  hasMore: boolean;
  moreStatus: MoreStoriesStatus;
  onShowMore: () => void;
}

const CLOCK_TICK_MS = 10_000;

/** The stories this browser is in, each a link to its page, with whose turn it is. */
export function MyStories({ stories, hasMore, moreStatus, onShowMore }: MyStoriesProps) {
  const now = useNow(CLOCK_TICK_MS);
  const media = useMedia();

  return (
    <YStack role="region" aria-label="Your stories" gap={media.md ? "10" : "6"}>
      <H2 fontFamily="story" fontSize="3xl" lineHeight="3xl" fontWeight="600">
        Your stories
      </H2>
      <YStack role="list" borderTopWidth={1} borderColor="border-color">
        {stories.map((story) => (
          <YStack key={story.id} role="listitem" borderBottomWidth={1} borderColor="border-color">
            <Link href={`/${story.id}`} asChild>
              <Anchor
                display="flex"
                flexDirection="column"
                gap="1"
                py="4"
                textDecorationLine="none"
              >
                <Paragraph
                  fontFamily="story"
                  fontSize={media.md ? "2xl" : "lg"}
                  lineHeight={media.md ? "2xl" : "lg"}
                  numberOfLines={2}
                >
                  <Opening text={story.opening} authorId={story.openingAuthorId} />
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
      {hasMore && (
        <YStack gap="2" items="flex-start">
          <Button
            size="xl"
            variant="outlined"
            disabled={moreStatus === "loading"}
            onPress={onShowMore}
          >
            {moreStatus === "loading" ? "Loading…" : "Show more"}
          </Button>
          <Paragraph role="alert" minH="6" color="error">
            {moreStatus === "failed" ? "Couldn’t load more stories." : ""}
          </Paragraph>
        </YStack>
      )}
    </YStack>
  );
}
