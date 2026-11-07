import { useAuth } from "@clerk/expo";
import { SignIn as ClerkSignIn } from "@clerk/expo/web";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Paragraph, useTheme } from "tamagui";

import { addDeviceUserToAccount } from "../client/account";
import { SimplePage } from "./SimplePage";

/**
 * `/sign-in`: Clerk's own sign-in and sign-up form. Once a session exists it brings this
 * device's stories into the account, then opens the home page.
 *
 * The web build uses Clerk's prebuilt component. A `SignIn.native.tsx` beside this file takes over on
 * the phone apps.
 */
export function SignIn() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const appearance = useClerkAppearance();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return;
    }

    void (async () => {
      await addDeviceUserToAccount();
      router.replace("/");
    })();
  }, [isLoaded, isSignedIn, router]);

  return (
    <SimplePage>
      {isSignedIn === true ? (
        <Paragraph role="status" color="muted">
          Signing you in…
        </Paragraph>
      ) : (
        <ClerkSignIn routing="hash" withSignUp fallbackRedirectUrl="/" appearance={appearance} />
      )}
    </SimplePage>
  );
}

// Clerk draws its form with its own CSS, so it takes colour values rather than our theme keys.
// Each is the value of a theme role, so light and dark follow the app. `colorBorder` is the text
// colour, not our border role, because Clerk draws its borders at a fixed 11% opacity of it.
function useClerkAppearance() {
  const theme = useTheme();

  return {
    variables: {
      colorBackground: theme.background.val,
      colorForeground: theme.color.val,
      colorMutedForeground: theme.muted.val,
      colorNeutral: theme.color.val,
      colorPrimary: theme.primary.val,
      colorPrimaryForeground: theme.background.val,
      colorDanger: theme.error.val,
      colorBorder: theme.color.val,
      colorInput: theme.background.val,
      colorInputForeground: theme.color.val,
      fontFamily: "Inter_400Regular, system-ui, sans-serif",
    },
  };
}
