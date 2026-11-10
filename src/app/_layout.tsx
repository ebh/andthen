// The stock Switch skin doesn't reset the browser's default button border, so it shows as a 2px outset.
import "@tamagui/core/reset.css";
import "../../tamagui.generated.css";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { SourceSerif4_400Regular } from "@expo-google-fonts/source-serif-4/400Regular";
import { SourceSerif4_600SemiBold } from "@expo-google-fonts/source-serif-4/600SemiBold";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { FontDisplay, useFonts } from "expo-font";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { ScrollView, TamaguiProvider, YStack } from "tamagui";
import { z } from "zod";

import { tamaguiConfig } from "../../tamagui.config";
import { startAppInstall } from "../client/appInstall";
import { startAppUpdates } from "../client/appUpdate";
import { startTurnAlerts } from "../client/turnAlerts";
import { BlocksProvider } from "../client/useBlocks";
import { AddDeviceUserOnLoad } from "../ui/AddDeviceUserOnLoad";
import { ShareClerkSessionToken } from "../ui/ShareClerkSessionToken";
import { UpdateGate } from "../ui/UpdateGate";
import { UpdateReady } from "../ui/UpdateReady";

const publishableKey = readPublishableKey();

// Not in an effect: the browser can fire `beforeinstallprompt` before React mounts the layout.
startAppInstall();

export default function Layout() {
  const scheme = useColorScheme();
  // Render at once and let the fonts swap in. Returning null until they load left the page white
  // for the whole download.
  useFonts({
    Inter_400Regular: { uri: Inter_400Regular, display: FontDisplay.SWAP },
    Inter_600SemiBold: { uri: Inter_600SemiBold, display: FontDisplay.SWAP },
    SourceSerif4_400Regular: { uri: SourceSerif4_400Regular, display: FontDisplay.SWAP },
    SourceSerif4_600SemiBold: { uri: SourceSerif4_600SemiBold, display: FontDisplay.SWAP },
  });

  useEffect(() => {
    void startAppUpdates();
    void startTurnAlerts();
  }, []);

  return (
    <ClerkProvider publishableKey={publishableKey} {...(tokenCache && { tokenCache })}>
      <ShareClerkSessionToken />
      <AddDeviceUserOnLoad />
      <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme === "dark" ? "dark" : "light"}>
        {/* Expo's web root fixes the body to the viewport, so the app scrolls inside this ScrollView
          (https://docs.expo.dev/router/reference/static-rendering/#root-html). flexGrow lets a short
          page fill the height; a page root must use `grow={1}`, because `flex={1}` has a zero basis
          and is clamped to the screen height while its content overflows. */}
        <BlocksProvider>
          <YStack flex={1}>
            <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
              <UpdateGate />
            </ScrollView>
            <UpdateReady />
          </YStack>
        </BlocksProvider>
      </TamaguiProvider>
    </ClerkProvider>
  );
}

// Read with this exact expression: Expo replaces it with the value when it bundles.
function readPublishableKey(): string {
  return z
    .string({ error: "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set. See .env." })
    .min(1)
    .parse(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);
}
