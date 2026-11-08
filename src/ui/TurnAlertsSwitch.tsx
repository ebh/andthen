import { useId } from "react";
import { Label, Paragraph, Switch, XStack, YStack } from "tamagui";

import { useTurnAlerts } from "../client/turnAlerts";

/** The reader's switch for "your turn" notifications, or the reason there is none. */
export function TurnAlertsSwitch() {
  const { state, turnOn, turnOff } = useTurnAlerts();
  const switchId = useId();

  if (state.type === "unavailable") {
    return null;
  }
  if (state.type === "needs_install") {
    return (
      <Paragraph color="muted">
        To get notified, add this app to your Home Screen: tap Share (under ⋯ on newer iPhones),
        then Add to Home Screen.
      </Paragraph>
    );
  }

  const blocked = state.type === "blocked";
  const on = state.type === "ready" && state.on;
  const busy = state.type === "ready" && state.busy;
  const failed = state.type === "ready" && state.failed;

  return (
    <YStack gap="2" items="flex-start">
      <XStack items="center" gap="3">
        <Label htmlFor={switchId}>Notify me when it&apos;s my turn</Label>
        <Switch
          id={switchId}
          size="xl"
          checked={on}
          disabled={blocked || busy}
          onCheckedChange={(next) => {
            void (next ? turnOn() : turnOff());
          }}
        >
          <Switch.Thumb />
        </Switch>
      </XStack>
      {blocked && (
        <Paragraph color="muted">
          Notifications are blocked in this browser&apos;s settings.
        </Paragraph>
      )}
      {failed && (
        <Paragraph role="alert" color="error">
          {on
            ? "Notifications couldn't be turned off in this browser."
            : "Notifications couldn't be turned on in this browser."}
        </Paragraph>
      )}
    </YStack>
  );
}
