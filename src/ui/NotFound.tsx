import { Link } from "expo-router";
import { Anchor, H2, Paragraph, YStack } from "tamagui";

import { SimplePage } from "./SimplePage";

interface NotFoundProps {
  message?: string;
}

/** The page for any URL the app has no page for, or a story that doesn't exist. */
export function NotFound({ message = "There's nothing at this address." }: NotFoundProps) {
  return (
    <SimplePage>
      <YStack gap="3" items="flex-start">
        <H2 fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600">
          Not found
        </H2>
        <Paragraph>{message}</Paragraph>
        <Link href="/" asChild>
          <Anchor>Start a new story</Anchor>
        </Link>
      </YStack>
    </SimplePage>
  );
}
