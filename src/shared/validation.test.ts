import { describe, expect, it } from "vitest";

import {
  chooseDisplayName,
  displayNameKey,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSAGE_LENGTH,
  normaliseStoryId,
  passageLength,
  TURN_WINDOW_MS,
  truncatePassage,
  validateDisplayName,
  validatePassage,
} from "./validation";

const FAMILY = "👨‍👩‍👧‍👦"; // four people joined by ZWJ: 7 code points, 1 grapheme
const E_ACUTE_DECOMPOSED = "é"; // "e" plus a combining acute accent: 2 code points

describe("limits", () => {
  it("pins the agreed values", () => {
    expect(MAX_PASSAGE_LENGTH).toBe(280);
    expect(MAX_DISPLAY_NAME_LENGTH).toBe(40);
    expect(TURN_WINDOW_MS).toBe(86_400_000);
  });
});

describe("validatePassage", () => {
  it("accepts exactly the limit", () => {
    const text = "a".repeat(MAX_PASSAGE_LENGTH);
    expect(validatePassage(text)).toEqual({ ok: true, value: text });
  });

  it("rejects one over the limit", () => {
    expect(validatePassage("a".repeat(MAX_PASSAGE_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("returns the trimmed text", () => {
    expect(validatePassage("  Once upon a time.\n")).toEqual({
      ok: true,
      value: "Once upon a time.",
    });
  });

  // Each pins one side of trim(): only trimming both ends brings these to the limit.
  it.each([
    ["leading", ` ${"a".repeat(MAX_PASSAGE_LENGTH)}`],
    ["trailing", `${"a".repeat(MAX_PASSAGE_LENGTH)} `],
  ])("does not count %s whitespace", (_side, text) => {
    expect(validatePassage(text)).toEqual({ ok: true, value: "a".repeat(MAX_PASSAGE_LENGTH) });
  });

  it.each(["", "   ", "\n\t "])("rejects empty or blank %j", (text) => {
    expect(validatePassage(text)).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a single grapheme", () => {
    expect(validatePassage("a")).toEqual({ ok: true, value: "a" });
  });

  it.each([
    ["an emoji", "😀"],
    ["a ZWJ family emoji", FAMILY],
    ["a letter with a combining mark", E_ACUTE_DECOMPOSED],
    ["a flag", "🇳🇿"],
  ])("counts %s as one grapheme", (_name, grapheme) => {
    const atLimit = grapheme.repeat(MAX_PASSAGE_LENGTH);
    expect(validatePassage(atLimit)).toEqual({ ok: true, value: atLimit });
    expect(validatePassage(grapheme.repeat(MAX_PASSAGE_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("passageLength", () => {
  it("counts trimmed graphemes, so an emoji is 1", () => {
    expect(passageLength("")).toBe(0);
    expect(passageLength("  ab  ")).toBe(2);
    expect(passageLength(`a${FAMILY}b`)).toBe(3);
  });
});

describe("truncatePassage", () => {
  it("trims and leaves a passage within the limit alone", () => {
    expect(truncatePassage("  Short one.  ")).toBe("Short one.");
    expect(truncatePassage(` ${"a".repeat(MAX_PASSAGE_LENGTH)}`)).toBe(
      "a".repeat(MAX_PASSAGE_LENGTH),
    );
    expect(truncatePassage("a".repeat(MAX_PASSAGE_LENGTH))).toBe("a".repeat(MAX_PASSAGE_LENGTH));
  });

  it("cuts to the limit in graphemes, never inside one", () => {
    const cut = truncatePassage(`${"a".repeat(MAX_PASSAGE_LENGTH - 1)}${FAMILY}${FAMILY}`);

    expect(cut).toBe(`${"a".repeat(MAX_PASSAGE_LENGTH - 1)}${FAMILY}`);
  });

  it("trims whitespace the cut leaves at the end", () => {
    expect(truncatePassage(`${"a".repeat(MAX_PASSAGE_LENGTH - 1)} b`)).toBe(
      "a".repeat(MAX_PASSAGE_LENGTH - 1),
    );
  });

  it("returns an empty string for blank text", () => {
    expect(truncatePassage(" \n ")).toBe("");
  });
});

describe("validateDisplayName", () => {
  it("accepts exactly the limit", () => {
    const name = "a".repeat(MAX_DISPLAY_NAME_LENGTH);
    expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
  });

  it("rejects one over the limit", () => {
    expect(validateDisplayName("a".repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("counts graphemes, not code points", () => {
    const name = FAMILY.repeat(MAX_DISPLAY_NAME_LENGTH);
    expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
  });

  it("trims, and rejects a blank name", () => {
    expect(validateDisplayName("  Ana ")).toEqual({ ok: true, value: "Ana" });
    expect(validateDisplayName("  ")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("displayNameKey", () => {
  it("ignores case", () => {
    expect(displayNameKey("Ana")).toBe("ana");
    expect(displayNameKey("ANA")).toBe(displayNameKey("ana"));
  });

  // Pins the uppercase step: "ß".toLowerCase() alone stays "ß", which would let "Strauß"
  // and "STRAUSS" both join one story.
  it("folds ß and SS together", () => {
    expect(displayNameKey("Strauß")).toBe(displayNameKey("STRAUSS"));
  });

  // Pins NFKC: without it the two spellings of "é" are different keys.
  it("treats composed and decomposed accents as one name", () => {
    expect(displayNameKey("René")).toBe(displayNameKey(`Ren${E_ACUTE_DECOMPOSED}`));
  });

  it("ignores surrounding whitespace", () => {
    expect(displayNameKey(" Ana ")).toBe("ana");
  });
});

describe("chooseDisplayName", () => {
  it("takes a valid name from a user who has none, with its key", () => {
    expect(chooseDisplayName("  Ana  ", null)).toEqual({
      ok: true,
      value: { displayName: "Ana", displayNameKey: displayNameKey("Ana") },
    });
  });

  it("keys a name the way displayNameKey does, ignoring case", () => {
    expect(chooseDisplayName("ANA", null)).toEqual({
      ok: true,
      value: { displayName: "ANA", displayNameKey: displayNameKey("ana") },
    });
  });

  it.each([
    ["no name", undefined],
    ["a blank name", "   "],
    ["a name over the limit", "x".repeat(MAX_DISPLAY_NAME_LENGTH + 1)],
  ])("refuses %s from a user who has none", (_case, requested) => {
    expect(chooseDisplayName(requested, null)).toEqual({
      ok: false,
      reason: "invalid_display_name",
    });
  });

  it("changes nothing when a user who has a name sends none", () => {
    expect(chooseDisplayName(undefined, "Ana")).toEqual({ ok: true, value: null });
  });

  it.each(["Ana", "Ben", "", "   "])(
    "refuses any name (%j) from a user who has one, because it would read as a rename",
    (requested) => {
      expect(chooseDisplayName(requested, "Ana")).toEqual({ ok: false, reason: "bad_request" });
    },
  );
});

describe("normaliseStoryId", () => {
  it("keeps a lowercase ID as is", () => {
    expect(normaliseStoryId("abc12")).toBe("abc12");
  });

  it("lowercases uppercase ASCII", () => {
    expect(normaliseStoryId("ABC12")).toBe("abc12");
    expect(normaliseStoryId("AbC12")).toBe("abc12");
  });

  // U+212A KELVIN SIGN lowercases to ASCII "k"; accepting it would alias "Kabc1" to "kabc1".
  it("rejects a non-ASCII letter that lowercases to ASCII", () => {
    expect(normaliseStoryId("Kabc1")).toBeNull();
  });

  it.each(["abc1", "abc123", "abc-1", "", " abc12", "abc12 "])("rejects %j", (raw) => {
    expect(normaliseStoryId(raw)).toBeNull();
  });
});
