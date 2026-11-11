import { describe, expect, it } from "vitest";

import { standIn } from "./standIn";

describe("standIn", () => {
  it.each([
    {
      title: "keeps every space and newline and replaces every other character",
      text: "A fox,\n  found a key!",
      expected: "e taoi\n  nshrd l ueta",
    },
    {
      title: "turns an emoji joined from several code points into one letter",
      text: "👨‍👩‍👧",
      expected: "e",
    },
    { title: "turns a letter with an accent into one letter", text: "é", expected: "e" },
    {
      title: "turns a letter and a combining accent into one letter",
      text: "é",
      expected: "e",
    },
    { title: "turns an emoji between spaces into one letter", text: "a 😀 b", expected: "e t a" },
    { title: "keeps a Windows line break as it is", text: "a\r\nb", expected: "e\r\nt" },
    {
      title: "varies the letters and starts over after the last one",
      text: "x".repeat(25),
      expected: "etaoinshrdluetaoinshrdlue",
    },
    {
      title: "gives the same stand-in for the same text",
      text: "Morning came.",
      expected: "etaoins hrdlu",
    },
    { title: "is empty for no text", text: "", expected: "" },
    { title: "does not spell the original word", text: "zzzz yyyy", expected: "etao insh" },
  ])("$title", ({ text, expected }) => {
    expect(standIn(text)).toBe(expected);
  });
});
