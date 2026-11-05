import { Button, H2, Paragraph, YStack } from "tamagui";

import { SimplePage } from "./SimplePage";

/** Replaces the whole app once the Worker has refused this build's API level. */
export function UpdateRequired() {
  return (
    <SimplePage>
      <YStack gap="3" items="flex-start">
        <H2 fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600">
          Update to continue
        </H2>
        <Paragraph>This version of And then… is out of date.</Paragraph>
        <Button
          theme="primary"
          onPress={() => {
            window.location.reload();
          }}
        >
          Update now
        </Button>
      </YStack>
    </SimplePage>
  );
}
