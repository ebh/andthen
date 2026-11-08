import { describe, expect, it } from "vitest";

import { findChangedLegalFiles } from "./legalVersionCheck";

describe("findChangedLegalFiles", () => {
  it.each([
    ["no changes", ""],
    ["only a newline", "\n"],
    ["one new file", "A\tlegal/privacy-policy/v2.md\n"],
    ["several new files", "A\tlegal/privacy-policy/v2.md\nA\tlegal/terms-of-service/v2.md\n"],
  ])("accepts %s", (_name, output) => {
    expect(findChangedLegalFiles(output)).toEqual([]);
  });

  it.each([
    ["a modified file", "M\tlegal/privacy-policy/v1.md", ["legal/privacy-policy/v1.md"]],
    ["a deleted file", "D\tlegal/privacy-policy/v1.md", ["legal/privacy-policy/v1.md"]],
    [
      "a rename, naming both paths",
      "R100\tlegal/privacy-policy/v1.md\tlegal/privacy-policy/v2.md",
      ["legal/privacy-policy/v1.md", "legal/privacy-policy/v2.md"],
    ],
    [
      "a copy, naming both paths",
      "C085\tlegal/privacy-policy/v1.md\tlegal/privacy-policy/v2.md",
      ["legal/privacy-policy/v1.md", "legal/privacy-policy/v2.md"],
    ],
    ["a type change", "T\tlegal/privacy-policy/v1.md", ["legal/privacy-policy/v1.md"]],
  ])("rejects %s", (_name, output, expected) => {
    expect(findChangedLegalFiles(output)).toEqual(expected);
  });

  it("names only the offending files among new ones", () => {
    const output = "A\tlegal/privacy-policy/v2.md\nM\tlegal/terms-of-service/v1.md\n\n";

    expect(findChangedLegalFiles(output)).toEqual(["legal/terms-of-service/v1.md"]);
  });
});
