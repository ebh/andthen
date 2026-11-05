import { useId, useState } from "react";
import { Button, Input, Label, Paragraph, YStack } from "tamagui";

interface InviteLinkProps {
  url: string;
}

type CopyState = "idle" | "copied" | "failed";

/** The story's address with a copy button. Anyone with the link can join. */
export function InviteLink({ url }: InviteLinkProps) {
  const fieldId = useId();
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      // No clipboard permission, or an insecure page: the field stays selectable.
      setCopyState("failed");
    }
  };

  return (
    <YStack gap="2" w="100%">
      <Label htmlFor={fieldId}>Invite link</Label>
      <Input id={fieldId} size="md" readOnly selectTextOnFocus value={url} />
      <Button
        size="xl"
        onPress={() => {
          void copy();
        }}
      >
        Copy link
      </Button>
      <Paragraph role="status" minH="6">
        {copyState === "copied" && "Link copied."}
        {copyState === "failed" && "Couldn't copy. Select the link and copy it yourself."}
      </Paragraph>
    </YStack>
  );
}
