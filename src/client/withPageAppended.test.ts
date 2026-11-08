import { describe, expect, it } from "vitest";

import type { StorySummary } from "../shared/api";
import { withPageAppended } from "./withPageAppended";

const story = (id: string): StorySummary => ({
  id,
  opening: "The lighthouse keeper found a letter.",
  holderName: null,
  isMyTurn: false,
  endsAt: null,
  writerCount: 1,
});

describe("withPageAppended", () => {
  it.each([
    ["a page of new stories", ["a1111"], ["b2222", "c3333"], ["a1111", "b2222", "c3333"]],
    ["an empty page", ["a1111"], [], ["a1111"]],
    ["nothing shown yet", [], ["a1111"], ["a1111"]],
    [
      "a story on both pages, which keeps its first place",
      ["a1111", "b2222"],
      ["b2222", "c3333"],
      ["a1111", "b2222", "c3333"],
    ],
    [
      "a page of stories all shown already",
      ["a1111", "b2222"],
      ["a1111", "b2222"],
      ["a1111", "b2222"],
    ],
  ])("appends %s", (_name, shown, page, expected) => {
    const ids = withPageAppended(shown.map(story), page.map(story)).map(({ id }) => id);

    expect(ids).toEqual(expected);
  });

  it("keeps the shown story rather than the repeat of it", () => {
    const shown = { ...story("a1111"), writerCount: 1 };
    const repeat = { ...story("a1111"), writerCount: 2 };

    expect(withPageAppended([shown], [repeat])).toEqual([shown]);
  });
});
