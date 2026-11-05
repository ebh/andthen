import { describe, expect, it } from "vitest";

import { setLeftStoryNote, takeLeftStoryNote } from "./leftStoryNote";

describe("the story-left note", () => {
  it("is absent until a story is left", () => {
    expect(takeLeftStoryNote()).toBe(false);
  });

  it("is given once, then forgotten", () => {
    setLeftStoryNote();

    expect(takeLeftStoryNote()).toBe(true);
    expect(takeLeftStoryNote()).toBe(false);
  });
});
