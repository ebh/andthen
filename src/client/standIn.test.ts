import { describe, expect, it } from "vitest";

import { standIn } from "./standIn";

describe("standIn", () => {
  it("keeps every space and newline and replaces every other character", () => {
    const text = "A fox,\n  found a key!";
    const hidden = standIn(text);

    expect(hidden).toHaveLength(text.length);
    expect(hidden.replace(/\S/gu, "#")).toBe(text.replace(/\S/gu, "#"));
    expect(hidden).toMatch(/^[a-z\s]+$/u);
  });

  it("turns a character made of several code points into one letter", () => {
    expect(standIn("👨‍👩‍👧")).toHaveLength(1);
    expect(standIn("é")).toHaveLength(1);
    expect(standIn("a 😀 b")).toHaveLength("a   b".length);
  });

  it("keeps a Windows line break as it is", () => {
    expect(standIn("a\r\nb")).toHaveLength(4);
  });

  it("varies the letters and starts over after the last one", () => {
    const hidden = standIn("x".repeat(25));

    expect(new Set(hidden.slice(0, 12)).size).toBe(12);
    expect(hidden.slice(12, 24)).toBe(hidden.slice(0, 12));
    expect(hidden[24]).toBe(hidden[0]);
  });

  it("gives the same stand-in for the same text and is empty for no text", () => {
    expect(standIn("Morning came.")).toBe(standIn("Morning came."));
    expect(standIn("")).toBe("");
  });

  it("does not spell the original word", () => {
    expect(standIn("zzzz yyyy")).not.toContain("zzzz");
  });
});
