import { AlertDialog, Button, Paragraph, XStack } from "tamagui";

import type { TurnAfterLeaving } from "../client/storyRules";

interface LeaveDialogProps {
  turnAfterLeaving: TurnAfterLeaving;
  /** True while the request to leave is in flight. */
  leaving: boolean;
  /** Why the last attempt failed, or null. */
  error: string | null;
  /** Called each time the dialog opens, so the page can forget an earlier attempt's error. */
  onOpen: () => void;
  onConfirm: () => void;
}

/**
 * The quiet "Leave story" button and the dialog it opens. The dialog asks first and says what
 * leaving costs: the turn passes on if the writer holds it, and they can come back through the
 * invite link.
 */
export function LeaveDialog({
  turnAfterLeaving,
  leaving,
  error,
  onOpen,
  onConfirm,
}: LeaveDialogProps) {
  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button size="xl" variant="outlined" theme="transparent">
          Leave story
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay theme="scrim" />
        <AlertDialog.Content gap="3" maxW="narrow" mx="5">
          <AlertDialog.Title fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600">
            Leave this story?
          </AlertDialog.Title>
          <AlertDialog.Description>
            Your passages stay in the story under your name. You’ll drop out of the turn order.{" "}
            {describeTurn(turnAfterLeaving)}
          </AlertDialog.Description>
          <Paragraph color="muted">You can rejoin from the invite link.</Paragraph>
          <Paragraph role="alert" minH="6" color="error">
            {error}
          </Paragraph>
          <XStack flexWrap="wrap" justify="flex-end" gap="3">
            <AlertDialog.Cancel asChild>
              <Button size="xl" variant="outlined" theme="transparent">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            {/* Not AlertDialog.Action: that closes the dialog, and a failed leave keeps it open. */}
            <Button size="xl" disabled={leaving} onPress={onConfirm}>
              {leaving ? "Leaving…" : "Leave story"}
            </Button>
          </XStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}

function describeTurn(turn: TurnAfterLeaving): string {
  if (turn.type === "passes_to") {
    return `It’s your turn now, so it passes to ${turn.displayName}.`;
  }
  if (turn.type === "waits") {
    return "It’s your turn now. No one else can take it, so the story will wait for someone to join.";
  }

  return "";
}
