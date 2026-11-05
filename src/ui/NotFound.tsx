import { Link } from "expo-router";
import { Anchor, H2, Paragraph, YStack } from "tamagui";

import { Wordmark } from "./Wordmark";

interface NotFoundProps {
  message?: string;
}

/** The page for any URL the app has no page for, or a story that doesn't exist. */
export function NotFound({ message = "There's nothing at this address." }: NotFoundProps) {
  return (
    <YStack bg="background" minH="100vh" p="5" gap="8" items="flex-start">
      <Wordmark />
      <YStack gap="4" items="flex-start">
        <H2 fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600">
          Not found
        </H2>
        <Paragraph>{message}</Paragraph>
        <Link href="/" asChild>
          <Anchor>Start a new story</Anchor>
        </Link>
      </YStack>
    </YStack>
  );
}
