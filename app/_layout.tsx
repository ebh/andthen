import "../tamagui.generated.css";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { SourceSerif4_400Regular } from "@expo-google-fonts/source-serif-4/400Regular";
import { SourceSerif4_600SemiBold } from "@expo-google-fonts/source-serif-4/600SemiBold";
import { useFonts } from "expo-font";
import { Slot } from "expo-router";
import { useColorScheme } from "react-native";
import { TamaguiProvider } from "tamagui";

import { tamaguiConfig } from "../tamagui.config";

export default function Layout() {
  const scheme = useColorScheme();
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    SourceSerif4_400Regular,
    SourceSerif4_600SemiBold,
  });

  if (!loaded && error === null) {
    return null;
  }

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme === "dark" ? "ink" : "paper"}>
      <Slot />
    </TamaguiProvider>
  );
}
