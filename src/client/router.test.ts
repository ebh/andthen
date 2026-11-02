import { describe, expect, it } from "vitest";

import { parseRoute } from "./router";

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
