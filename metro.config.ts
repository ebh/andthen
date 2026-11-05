import { withTamagui } from "@tamagui/cli/metro";
import { getDefaultConfig } from "expo/metro-config";

export default withTamagui(getDefaultConfig(import.meta.dirname));
