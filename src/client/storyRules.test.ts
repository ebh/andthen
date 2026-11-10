import { describe, expect, it } from "vitest";

import { canSkipTurn, turnAfterLeaving } from "./storyRules";
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

describe("turnAfterLeaving", () => {
  it("leaves the turn alone when someone else holds it", () => {
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME });

    expect(turnAfterLeaving(view)).toEqual({ type: "unchanged" });
  });

  it("leaves a waiting story alone", () => {
    const view = storyView({ participants: [ME], holderId: null, lastWriterId: ME });

    expect(turnAfterLeaving(view)).toEqual({ type: "unchanged" });
  });

  it("passes the turn to the next writer when the holder leaves", () => {
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: THIRD });

    expect(turnAfterLeaving(view)).toEqual({ type: "passes_to", displayName: "Sam" });
  });

  it("passes over the one who wrote last", () => {
    // ME holds and leaves; the next place is OTHER, who wrote last, so THIRD gets it.
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER });

    expect(turnAfterLeaving(view)).toEqual({ type: "passes_to", displayName: "Kim" });
  });

  it("finds the last writer by the passage author's user, not the participant ID", () => {
    // Same setup as the test above; if authors were matched to participant IDs, no one would be found.
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER });

    expect(view.passages[0]?.authorId).not.toBe(OTHER);
    expect(turnAfterLeaving(view)).toEqual({ type: "passes_to", displayName: "Kim" });
  });

  it("makes the story wait when the one left wrote last", () => {
    const view = storyView({ participants: [OTHER, ME], holderId: ME, lastWriterId: OTHER });

    expect(turnAfterLeaving(view)).toEqual({ type: "waits" });
  });
});
