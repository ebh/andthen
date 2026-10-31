import { describe, expect, it } from "vitest";

import { MAX_PASSAGE_LENGTH } from "../../shared/validation";
import { parseSuggestions } from "./parse";

const THREE = ["One.", "Two.", "Three."];

describe("parseSuggestions", () => {
  it("accepts the object a JSON-mode model returns", () => {
    expect(parseSuggestions({ suggestions: THREE })).toEqual(THREE);
  });

  it("accepts the same object as JSON text", () => {
    expect(parseSuggestions(JSON.stringify({ suggestions: THREE }))).toEqual(THREE);
  });

  it("rejects text that is not JSON, and output that is not an object", () => {
    for (const raw of ["not json", "", null, undefined, 3, [], THREE]) {
      expect(parseSuggestions(raw)).toBeNull();
    }
  });

  it("rejects the wrong number of suggestions, and non-string ones", () => {
    const wrong = [[], ["a", "b"], ["a", "b", "c", "d"], ["a", "b", 3], ["a", "b", null]];

    for (const suggestions of wrong) {
      expect(parseSuggestions({ suggestions })).toBeNull();
    }
    expect(parseSuggestions({})).toBeNull();
  });

  it("trims each suggestion", () => {
    expect(parseSuggestions({ suggestions: ["  A  ", "\nB\n", "C "] })).toEqual(["A", "B", "C"]);
  });

  it("cuts a long suggestion to the passage limit", () => {
    const long = "a".repeat(MAX_PASSAGE_LENGTH + 50);

    expect(parseSuggestions({ suggestions: [long, "B", "C"] })).toEqual([
      "a".repeat(MAX_PASSAGE_LENGTH),
      "B",
      "C",
    ]);
  });

  it("rejects an empty or blank suggestion, wherever it is", () => {
    for (const blank of ["", "   \n"]) {
      expect(parseSuggestions({ suggestions: [blank, "B", "C"] })).toBeNull();
      expect(parseSuggestions({ suggestions: ["A", blank, "C"] })).toBeNull();
      expect(parseSuggestions({ suggestions: ["A", "B", blank] })).toBeNull();
    }
  });

  it("rejects duplicates, ignoring case, spacing and Unicode form", () => {
    const duplicates = [
      ["Same.", "Same.", "Other."],
      ["Same.", "Other.", " same. "],
      ["Other.", "Same.", "SAME."],
      ["é", "x", "é"],
    ];

    for (const suggestions of duplicates) {
      expect(parseSuggestions({ suggestions })).toBeNull();
    }
  });

  it("rejects two long suggestions that only differ after the cut", () => {
    const start = "a".repeat(MAX_PASSAGE_LENGTH);

    expect(parseSuggestions({ suggestions: [`${start}1`, `${start}2`, "C"] })).toBeNull();
  });
});
