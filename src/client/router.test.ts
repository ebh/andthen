// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearJustLeftStory,
  justLeftStory,
  navigate,
  navigateHomeAfterLeaving,
  parseRoute,
} from "./router";

describe("parseRoute", () => {
  it("routes / to a new story", () => {
    expect(parseRoute("/")).toEqual({ type: "new_story" });
  });

  it("routes a story ID, lowercased, with or without a trailing slash", () => {
    expect(parseRoute("/AbC12")).toEqual({ type: "story", storyId: "abc12" });
    expect(parseRoute("/abc12/")).toEqual({ type: "story", storyId: "abc12" });
  });

  it("sends anything else to the unknown page", () => {
    expect(parseRoute("/abc")).toEqual({ type: "unknown_page" });
    expect(parseRoute("/abc12/extra")).toEqual({ type: "unknown_page" });
  });
});

describe("leaving a story", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/abc12");
  });

  it("goes home with a note that is there until it is cleared", () => {
    expect(justLeftStory()).toBe(false);

    navigateHomeAfterLeaving();

    expect(window.location.pathname).toBe("/");
    expect(justLeftStory()).toBe(true);

    clearJustLeftStory();

    expect(justLeftStory()).toBe(false);
    expect(window.location.pathname).toBe("/");
  });

  it("carries no note when going anywhere else", () => {
    navigate("/");

    expect(justLeftStory()).toBe(false);
  });
});
