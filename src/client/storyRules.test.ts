import { describe, expect, it } from "vitest";

import { canSkipTurn } from "./storyRules";
import { ME, OTHER, THIRD, storyView } from "./testFixtures";

describe("canSkipTurn", () => {
  it("is true for a non-holder when a third person can take the turn", () => {
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME });

    expect(canSkipTurn(view)).toBe(true);
  });

  it("is false for the holder", () => {
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER });

    expect(canSkipTurn(view)).toBe(false);
  });

  it("is false with two people, where the turn would come straight back", () => {
    const view = storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME });

    expect(canSkipTurn(view)).toBe(false);
  });

  it("is false while the story waits for a joiner", () => {
    const view = storyView({ participants: [ME], holderId: null, lastWriterId: ME });

    expect(canSkipTurn(view)).toBe(false);
  });
});
