import { describe, expect, it } from "vitest";

import {
  excerpt,
  MAX_EXCERPT_LENGTH,
  MIN_PUSH_TTL_SECONDS,
  turnNotification,
} from "./turnNotification";

const T0 = 1_700_000_000_000;

const input = {
  storyId: "abc12",
  opening: "It was a dark and stormy night.",
  origin: "https://app.andthen.page",
  now: T0,
  turnEndsAt: T0 + 24 * 60 * 60 * 1000,
};

describe("turnNotification", () => {
  it("is a declarative push that opens the story and replaces the story's earlier one", () => {
    expect(turnNotification(input)).toEqual({
      data: {
        web_push: 8030,
        notification: {
          title: "Your turn",
          body: "It was a dark and stormy night.",
          navigate: "https://app.andthen.page/abc12",
          tag: "turn-abc12",
        },
      },
      topic: "turn-abc12",
      ttlSeconds: 86_400,
    });
  });

  it("takes the origin it is given, so a preview links to the preview", () => {
    const { data } = turnNotification({ ...input, origin: "https://andthen-preview.example.dev" });

    expect(data.notification.navigate).toBe("https://andthen-preview.example.dev/abc12");
  });

  it("lives for the seconds left in the turn, rounded up", () => {
    expect(turnNotification({ ...input, turnEndsAt: T0 + 3_600_001 }).ttlSeconds).toBe(3601);
    expect(turnNotification({ ...input, turnEndsAt: T0 + 3_600_000 }).ttlSeconds).toBe(3600);
  });

  it("lives at least a minute, however little of the turn is left", () => {
    expect(MIN_PUSH_TTL_SECONDS).toBe(60);
    expect(turnNotification({ ...input, turnEndsAt: T0 + 59_000 }).ttlSeconds).toBe(60);
    expect(turnNotification({ ...input, turnEndsAt: T0 + 60_000 }).ttlSeconds).toBe(60);
    expect(turnNotification({ ...input, turnEndsAt: T0 + 61_000 }).ttlSeconds).toBe(61);
    expect(turnNotification({ ...input, turnEndsAt: T0 }).ttlSeconds).toBe(60);
  });
});

describe("excerpt", () => {
  it("keeps a short opening as it is", () => {
    expect(excerpt("Once upon a time.")).toBe("Once upon a time.");
  });

  it("keeps an opening of exactly the limit", () => {
    const text = "a".repeat(MAX_EXCERPT_LENGTH);

    expect(excerpt(text)).toBe(text);
  });

  it("cuts a long opening at a word and ends it with an ellipsis", () => {
    const text = "The old lighthouse keeper had not spoken to another soul in nearly forty years.";

    const result = excerpt(text);

    expect(result).toBe("The old lighthouse keeper had not spoken to another soul in…");
    expect(result.length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH + 1);
  });

  it("keeps the last word when the cut falls exactly on a word boundary", () => {
    const text = `${"a".repeat(MAX_EXCERPT_LENGTH - 5)} word and more`;

    expect(excerpt(text)).toBe(`${"a".repeat(MAX_EXCERPT_LENGTH - 5)} word…`);
  });

  it("cuts a long single word where it stands", () => {
    expect(excerpt("a".repeat(100))).toBe(`${"a".repeat(MAX_EXCERPT_LENGTH)}…`);
  });

  it("turns newlines and runs of spaces into single spaces and trims the ends", () => {
    expect(excerpt("  One\n\ntwo \t three  ")).toBe("One two three");
  });

  it("counts an emoji as one character and never splits it", () => {
    const text = "😀".repeat(MAX_EXCERPT_LENGTH + 1);

    expect(excerpt(text)).toBe(`${"😀".repeat(MAX_EXCERPT_LENGTH)}…`);
  });
});
