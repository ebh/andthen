import { describe, expect, it } from "vitest";

import type { PassageView } from "../shared/api";
import {
  highlightedAuthor,
  isSameAuthor,
  togglePin,
  uniqueAuthors,
  type AuthorInParagraph,
} from "./authorHighlight";

function passage(id: string, authorId: string, authorName: string): PassageView {
  return { id, authorId, authorName, text: "Text.", startsParagraph: false, createdAt: 1 };
}

const ana: AuthorInParagraph = { paragraph: 0, authorId: "p1" };
const ben: AuthorInParagraph = { paragraph: 0, authorId: "p2" };

describe("uniqueAuthors", () => {
  it.each([
    {
      name: "collapses a repeated author to one",
      turns: [passage("c1", "p1", "Ana"), passage("c2", "p1", "Ana")],
      expected: [{ authorId: "p1", authorName: "Ana" }],
    },
    {
      name: "keeps first-seen order",
      turns: [passage("c1", "p2", "Ben"), passage("c2", "p1", "Ana"), passage("c3", "p2", "Ben")],
      expected: [
        { authorId: "p2", authorName: "Ben" },
        { authorId: "p1", authorName: "Ana" },
      ],
    },
    {
      name: "uses the latest name for a repeated id",
      turns: [passage("c1", "p1", "Ana"), passage("c2", "p1", "Anna")],
      expected: [{ authorId: "p1", authorName: "Anna" }],
    },
    { name: "returns nothing for no turns", turns: [], expected: [] },
  ])("$name", ({ turns, expected }) => {
    expect(uniqueAuthors(turns)).toEqual(expected);
  });
});

describe("isSameAuthor", () => {
  it.each([
    { name: "is true for the same paragraph and author", a: ana, b: { ...ana }, expected: true },
    {
      name: "is false for a different paragraph",
      a: ana,
      b: { ...ana, paragraph: 1 },
      expected: false,
    },
    { name: "is false for a different author", a: ana, b: ben, expected: false },
    { name: "is false when nothing is set", a: null, b: ana, expected: false },
  ])("$name", ({ a, b, expected }) => {
    expect(isSameAuthor(a, b)).toBe(expected);
  });
});

describe("togglePin", () => {
  it.each([
    { name: "pins when nothing is pinned", pinned: null, author: ana, expected: ana },
    {
      name: "clears when the same author is pressed",
      pinned: ana,
      author: { ...ana },
      expected: null,
    },
    { name: "moves to a different author", pinned: ana, author: ben, expected: ben },
    {
      name: "moves to the same author in another paragraph",
      pinned: ana,
      author: { ...ana, paragraph: 1 },
      expected: { ...ana, paragraph: 1 },
    },
  ])("$name", ({ pinned, author, expected }) => {
    expect(togglePin(pinned, author)).toEqual(expected);
  });
});

describe("highlightedAuthor", () => {
  it.each([
    { name: "prefers the preview over the pin", previewed: ben, pinned: ana, expected: ben },
    {
      name: "falls back to the pin without a preview",
      previewed: null,
      pinned: ana,
      expected: ana,
    },
    { name: "is nothing when neither is set", previewed: null, pinned: null, expected: null },
  ])("$name", ({ previewed, pinned, expected }) => {
    expect(highlightedAuthor(previewed, pinned)).toEqual(expected);
  });
});
