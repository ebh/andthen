import type { ReactNode } from "react";
import { YStack } from "tamagui";

import { Wordmark } from "./Wordmark";

/** A centred column under the wordmark, for pages with one short thing to say or do. */
export function SimplePage({ children }: { children: ReactNode }) {
  return (
    <YStack bg="background" minH="100vh" p="5">
      <YStack gap="8" maxW="simplePage" w="100%" self="center">
        <Wordmark />
        <YStack gap="4">{children}</YStack>
      </YStack>
    </YStack>
  );
}
