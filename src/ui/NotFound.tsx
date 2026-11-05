import { Link } from "expo-router";
import { Button, H2, Paragraph, YStack } from "tamagui";

import { Wordmark } from "./Wordmark";

/** The page for any URL the app has no route for. */
export function NotFound() {
  return (
    <YStack bg="background" minH="100vh" p="5" gap="8" items="flex-start">
      <Wordmark />
      <YStack gap="4" items="flex-start">
        <H2 fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600">
          Not found
        </H2>
        <Paragraph>There&apos;s nothing at this address.</Paragraph>
        <Link href="/" asChild>
          <Button size="xl" bg="primary" color="primary-content">
            Start a new story
          </Button>
        </Link>
      </YStack>
    </YStack>
  );
}
