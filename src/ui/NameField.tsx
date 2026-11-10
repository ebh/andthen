import { useId } from "react";
import { Button, Input, Label, Paragraph, YStack } from "tamagui";

import { nameStep, type UserNameLoad } from "../client/userName";

interface NameFieldProps {
  load: UserNameLoad;
  reload: () => void;
  value: string;
  onChange: (value: string) => void;
}

/**
 * The name field, shown only while the user has no name. It waits for the answer rather than
 * showing the field and taking it away, and a user who has a name sees nothing here.
 */
export function NameField({ load, reload, value, onChange }: NameFieldProps) {
  const nameId = useId();
  const step = nameStep(load);

  if (step === "loading") {
    return (
      <Paragraph role="status" color="muted">
        Loading…
      </Paragraph>
    );
  }
  if (step === "failed") {
    return (
      <YStack role="alert" gap="3" items="flex-start">
        <Paragraph>Couldn&apos;t check your name.</Paragraph>
        <Button size="xl" variant="outlined" onPress={reload}>
          Retry
        </Button>
      </YStack>
    );
  }
  if (step === "known") {
    return null;
  }

  return (
    <YStack gap="2">
      <Label htmlFor={nameId}>Your name</Label>
      <Input id={nameId} size="xl" autoComplete="nickname" value={value} onChangeText={onChange} />
    </YStack>
  );
}
