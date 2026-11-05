import type { ReactNode } from "react";
import { YStack } from "tamagui";

import { Wordmark } from "./Wordmark";

/** A page with only the wordmark and one block of content: loading, errors and the join form. */
export function SimplePage({ children }: { children: ReactNode }) {
  return (
    <YStack bg="background" minH="100vh" p="5" gap="8" items="flex-start">
      <Wordmark />
      <YStack gap="4" items="flex-start" maxW="96" w="100%">
        {children}
      </YStack>
    </YStack>
  );
}
