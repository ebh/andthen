import { describe, expect, it } from "vitest";

import {
  blockOffer,
  canSkipTurn,
  headline,
  myUserId,
  skipLabel,
  turnAfterLeaving,
} from "./storyRules";
import { ME, OTHER, THIRD, storyView, userIdOf } from "./testFixtures";

describe("blockOffer", () => {
  const ben = { authorId: "u2", authorName: "Ben", myUserId: "u1" };

  it.each([
    {
      title: "offers Block on another author",
      author: { ...ben, blockId: null },
      offer: { type: "block", label: "Block Ben" },
    },
    {
      title: "offers Unblock on an author the user blocks",
      author: { ...ben, blockId: "b1" },
      offer: { type: "unblock", label: "Unblock Ben" },
    },
    {
      title: "offers nothing on the user's own name",
      author: { ...ben, authorId: "u1", authorName: "Ana", blockId: null },
      offer: { type: "none" },
    },
  ])("$title", ({ author, offer }) => {
    expect(blockOffer(author)).toEqual(offer);
  });
});

describe("myUserId", () => {
  it("is the user behind the participant the view is for", () => {
    const view = storyView({ participants: [OTHER, ME], holderId: ME, lastWriterId: OTHER });

    expect(myUserId(view)).toBe(userIdOf(ME));
  });

  it("throws when the view lacks the participant it is for", () => {
    const view = storyView({ participants: [OTHER], holderId: OTHER, lastWriterId: OTHER });

    expect(() => myUserId(view)).toThrow("No participant for");
  });
});

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

describe("headline", () => {
  it("says the story is waiting when nobody holds the turn", () => {
    const view = storyView({ participants: [ME], holderId: null, lastWriterId: ME });

    expect(headline(view, null)).toBe("Waiting for someone to join");
  });

  it("tells the holder it is their turn", () => {
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER });

    expect(headline(view, "Me")).toBe("It's your turn");
  });

  it("names another holder", () => {
    const view = storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME });

    expect(headline(view, "Sam")).toBe("It's Sam's turn");
  });
});

describe("skipLabel", () => {
  it.each([
    [true, "Sam", "Skipping…"],
    [false, "Sam", "Skip Sam"],
    [false, null, "Skip this turn"],
  ])("with skipping %s and holder %s reads %s", (skipping, holderName, label) => {
    expect(skipLabel(skipping, holderName)).toBe(label);
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
