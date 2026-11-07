import { useAuth, useUser } from "@clerk/expo";
import { Link } from "expo-router";
import { useState } from "react";
import { Anchor, Button, Paragraph, XStack, YStack } from "tamagui";

import { useTurnAlerts } from "../client/turnAlerts";

interface SignInStatusProps {
  /** Called after Clerk has signed out, so the page can reload what the account showed. */
  onSignedOut: () => void;
}

/**
 * Where the home page offers sign-in, or shows who is signed in with a quiet way to sign out.
 * Shows nothing until Clerk has loaded, since until then it can't tell the two apart.
 */
export function SignInStatus({ onSignedOut }: SignInStatusProps) {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const { turnOff } = useTurnAlerts();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn) {
    return (
      <YStack mt="4" gap="2" items="flex-start">
        <Paragraph color="muted">Use your stories on all your devices</Paragraph>
        <Link href="/sign-in" asChild>
          <Anchor>Sign in</Anchor>
        </Link>
      </YStack>
    );
  }

  // Alerts go off while the session can still authorise the Worker to delete this browser's push
  // subscription; once signed out the Worker could no longer tell whose it is.
  const leave = (): void => {
    setSigningOut(true);
    setFailed(false);
    void (async () => {
      try {
        await turnOff();
        await signOut();
        onSignedOut();
      } catch {
        setFailed(true);
      }
      setSigningOut(false);
    })();
  };

  return (
    <YStack mt="4" gap="2" items="flex-start">
      <XStack items="center" flexWrap="wrap" columnGap="3">
        <Paragraph color="muted">
          {user?.primaryEmailAddress?.emailAddress ?? "Signed in"}
        </Paragraph>
        <Button size="xl" variant="quiet" disabled={signingOut} onPress={leave}>
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </XStack>
      <Paragraph role="alert" minH="6" color="error">
        {failed ? "Couldn't sign out. Try again." : null}
      </Paragraph>
    </YStack>
  );
}
