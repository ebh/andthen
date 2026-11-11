import { describe, expect, it } from "vitest";
import { isStylingProp } from "./strykerStylePropIgnorer.ts";

describe("a prop the ignorer skips", () => {
  it.each([
    ["a Tamagui style prop", "gap"],
    ["another Tamagui style prop", "fontSize"],
    ["a shorthand from the app's config", "px"],
    ["a shorthand for a margin", "mt"],
    ["a shorthand for a background", "bg"],
    ["a variant prop", "size"],
    ["the theme variant", "theme"],
  ])("%s: %s", (_kind, name) => {
    expect(isStylingProp(name)).toBe(true);
  });
});

describe("a prop the ignorer keeps mutating", () => {
  it.each([
    ["disabled", "disabled"],
    ["an event handler", "onPress"],
    ["a role", "role"],
    ["a value", "value"],
    ["an ARIA attribute", "aria-label"],
    ["a link target", "href"],
    ["a checked state", "checked"],
    ["an id", "id"],
  ])("%s: %s", (_kind, name) => {
    expect(isStylingProp(name)).toBe(false);
  });
});
