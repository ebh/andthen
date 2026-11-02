import { describe, expect, it } from "vitest";

import { groupParagraphs } from "./paragraphs";

function turns(...flags: boolean[]) {
  return flags.map((startsParagraph, index) => ({ id: index + 1, startsParagraph }));
}

function ids(paragraphs: { id: number }[][]): number[][] {
  return paragraphs.map((paragraph) => paragraph.map((turn) => turn.id));
}

describe("groupParagraphs", () => {
  it("returns no paragraphs for no turns", () => {
    expect(groupParagraphs([])).toEqual([]);
  });

  it("starts a paragraph at every turn that asks for one", () => {
    expect(ids(groupParagraphs(turns(true, true, true)))).toEqual([[1], [2], [3]]);
  });

  it("keeps turns that don't ask for a new paragraph with the one before", () => {
    expect(ids(groupParagraphs(turns(true, false, false, true, false)))).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it("opens the first paragraph even when the first turn doesn't ask for one", () => {
    expect(ids(groupParagraphs(turns(false, false, true)))).toEqual([[1, 2], [3]]);
  });

  it("keeps the turns themselves, not copies", () => {
    const turn = { id: 1, startsParagraph: true };
    expect(groupParagraphs([turn])[0]?.[0]).toBe(turn);
  });
});
