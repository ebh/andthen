import { Button, Paragraph, XStack, YStack } from "tamagui";

import { useAppUpdate } from "../client/appUpdate";
import { useClientOutdated } from "../client/clientOutdated";

/**
 * A quiet bar under the page that says a newer version has been downloaded. It sits below the
 * scrolling page, not over it, so it never moves the story text or covers a control. The update
 * screen has its own button, so the bar steps aside for it.
 */
export function UpdateReady() {
  const { updateReady, applyUpdate } = useAppUpdate();
  const outdated = useClientOutdated();

  // The status region is always present and only its content comes and goes: a screen reader
  // announces text added to a live region that already exists, but often misses one that appears whole.
  return (
    <YStack role="status">
      {updateReady && !outdated && (
        <XStack
          theme="level2"
          bg="background"
          borderTopWidth={1}
          borderColor="border-color"
          px="5"
          py="3"
          gap="3"
          items="center"
          justify="center"
          flexWrap="wrap"
        >
          <Paragraph color="muted">A new version is ready.</Paragraph>
          <Button
            variant="outlined"
            size="xl"
            onPress={() => {
              void applyUpdate();
            }}
          >
            Update
          </Button>
        </XStack>
      )}
    </YStack>
  );
}
