import { declareValuePlugin, PluginKind } from "@stryker-mutator/api/plugin";
import type { babel } from "@stryker-mutator/core";
import { stylePropsAll } from "tamagui";
import { tamaguiConfig } from "../tamagui.config.ts";

// Stryker skips every mutant inside an attribute this returns a reason for. jsdom computes no
// layout and the tests assert on roles, names and text, so no test can tell `gap="4"` from
// `gap="5"`: those mutants would all survive and hide the ones that matter.
export const strykerPlugins = [
  declareValuePlugin(PluginKind.Ignore, "tamagui-style-props", {
    shouldIgnore(path: babel.NodePath): string | undefined {
      if (!path.isJSXAttribute()) return undefined;

      const { name } = path.node;
      if (name.type !== "JSXIdentifier" || !isStylingProp(name.name)) return undefined;

      return "Tamagui styling prop: no jsdom test can observe it";
    },
  }),
];

/** True for a prop that only changes how a component looks, never what it does or says. */
export function isStylingProp(name: string): boolean {
  return stylingProps.has(name);
}

// Variants of the app's Tamagui components that pick a look (`<Button size="xl" theme="brand">`).
const variantProps = ["size", "variant", "theme"];

const stylingProps = new Set([
  ...Object.keys(stylePropsAll),
  ...Object.keys(tamaguiConfig.shorthands),
  ...variantProps,
]);
