import "../../tamagui.generated.css";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { SourceSerif4_400Regular } from "@expo-google-fonts/source-serif-4/400Regular";
import { SourceSerif4_600SemiBold } from "@expo-google-fonts/source-serif-4/600SemiBold";
import { FontDisplay, useFonts } from "expo-font";
import { Slot } from "expo-router";
import { useColorScheme } from "react-native";
import { ScrollView, TamaguiProvider } from "tamagui";

import { tamaguiConfig } from "../../tamagui.config";

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

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme === "dark" ? "ink" : "paper"}>
      {/* Expo's web root fixes the body to the viewport, so the app scrolls inside this ScrollView
          (https://docs.expo.dev/router/reference/static-rendering/#root-html). flexGrow lets a short
          page fill the height; a page root must use `grow={1}`, because `flex={1}` has a zero basis
          and is clamped to the screen height while its content overflows. */}
      <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
        <Slot />
      </ScrollView>
    </TamaguiProvider>
  );
}
