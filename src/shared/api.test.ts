import { describe, expect, it } from "vitest";

import {
  contributeRequestSchema,
  createStoryRequestSchema,
  createStoryResponseSchema,
  errorBodySchema,
  errorCodeSchema,
  joinRequestSchema,
  liveMessageSchema,
  skipRequestSchema,
  storyIdSchema,
  storyViewSchema,
  suggestionsResponseSchema,
} from "./api";
import type { TurnRejection } from "./turnOrder";

const turnRejections = {
  stale_turn: true,
  not_your_turn: true,
  cannot_skip_self: true,
  no_one_to_skip_to: true,
} satisfies Record<TurnRejection, true>;

const storyView = {
  contributions: [{ id: "c1", authorId: "p1", authorName: "Ana", text: "Once.", createdAt: 1 }],
  participants: [
    { id: "p1", displayName: "Ana" },
    { id: "p2", displayName: "Ben" },
  ],
  turn: { holderId: "p2", endsAt: 86_400_001, version: 1 },
  me: "p1",
};

describe("request schemas", () => {
  it("accept well-formed bodies", () => {
    expect(
      createStoryRequestSchema.safeParse({ displayName: "Ana", opening: "Once." }).success,
    ).toBe(true);
    expect(joinRequestSchema.safeParse({ displayName: "Ben" }).success).toBe(true);
    expect(contributeRequestSchema.safeParse({ text: "Then.", turnVersion: 0 }).success).toBe(true);
    expect(skipRequestSchema.safeParse({ turnVersion: 3 }).success).toBe(true);
  });

  it.each([
    ["create without an opening", createStoryRequestSchema, { displayName: "Ana" }],
    ["create without a name", createStoryRequestSchema, { opening: "Once." }],
    ["join with a number name", joinRequestSchema, { displayName: 1 }],
    ["contribute without a version", contributeRequestSchema, { text: "Then." }],
    ["contribute without text", contributeRequestSchema, { turnVersion: 1 }],
    ["skip with a string version", skipRequestSchema, { turnVersion: "1" }],
    ["skip with a negative version", skipRequestSchema, { turnVersion: -1 }],
    ["skip with a fractional version", skipRequestSchema, { turnVersion: 1.5 }],
  ])("reject %s", (_case, schema, body) => {
    expect(schema.safeParse(body).success).toBe(false);
  });
});

describe("storyIdSchema", () => {
  it("accepts a lowercase five-character ID", () => {
    expect(storyIdSchema.parse("abc12")).toBe("abc12");
  });

  it.each(["", "abc1", "abc123", "ABC12", "abC12", "abc-1", " abc12", 12345])(
    "rejects %j",
    (id) => {
      expect(storyIdSchema.safeParse(id).success).toBe(false);
    },
  );
});

describe("createStoryResponseSchema", () => {
  it("accepts a story ID and rejects a missing or malformed one", () => {
    expect(createStoryResponseSchema.safeParse({ storyId: "abc12" }).success).toBe(true);
    expect(createStoryResponseSchema.safeParse({}).success).toBe(false);
    expect(createStoryResponseSchema.safeParse({ storyId: "garbage!" }).success).toBe(false);
  });
});

describe("storyViewSchema", () => {
  it("accepts a story with a turn holder", () => {
    expect(storyViewSchema.parse(storyView)).toEqual(storyView);
  });

  it("accepts a waiting story", () => {
    const waiting = { ...storyView, turn: { holderId: null, endsAt: null, version: 0 } };
    expect(storyViewSchema.safeParse(waiting).success).toBe(true);
  });

  it.each([
    ["a holder without an end time", { holderId: "p2", endsAt: null, version: 1 }],
    ["an end time without a holder", { holderId: null, endsAt: 5, version: 1 }],
    ["an empty holder ID", { holderId: "", endsAt: 5, version: 1 }],
    ["a negative end time", { holderId: "p2", endsAt: -1, version: 1 }],
    ["a missing version", { holderId: "p2", endsAt: 5 }],
  ])("rejects a turn with %s", (_case, turn) => {
    expect(storyViewSchema.safeParse({ ...storyView, turn }).success).toBe(false);
  });

  it.each([
    ["no me", { ...storyView, me: undefined }],
    ["an empty me", { ...storyView, me: "" }],
    [
      "a contribution without an author name",
      { ...storyView, contributions: [{ id: "c1", authorId: "p1", text: "x", createdAt: 1 }] },
    ],
    [
      "a contribution with an empty author ID",
      {
        ...storyView,
        contributions: [{ id: "c1", authorId: "", authorName: "Ana", text: "x", createdAt: 1 }],
      },
    ],
    [
      "a contribution with a fractional time",
      {
        ...storyView,
        contributions: [{ id: "c1", authorId: "p1", authorName: "Ana", text: "x", createdAt: 1.5 }],
      },
    ],
    ["a participant without a name", { ...storyView, participants: [{ id: "p1" }] }],
  ])("rejects a story with %s", (_case, view) => {
    expect(storyViewSchema.safeParse(view).success).toBe(false);
  });
});

describe("suggestionsResponseSchema", () => {
  it("accepts exactly three suggestions", () => {
    expect(suggestionsResponseSchema.safeParse({ suggestions: ["a", "b", "c"] }).success).toBe(
      true,
    );
  });

  it.each([[["a", "b"]], [["a", "b", "c", "d"]], [["a", "b", 3]]])("rejects %j", (suggestions) => {
    expect(suggestionsResponseSchema.safeParse({ suggestions }).success).toBe(false);
  });
});

describe("liveMessageSchema", () => {
  it("accepts a version and rejects anything else", () => {
    expect(liveMessageSchema.parse({ version: 4 })).toEqual({ version: 4 });
    expect(liveMessageSchema.safeParse({ version: "4" }).success).toBe(false);
    expect(liveMessageSchema.safeParse("ping").success).toBe(false);
  });
});

describe("errorBodySchema", () => {
  it.each(errorCodeSchema.options)("accepts %s", (code) => {
    expect(errorBodySchema.parse({ error: code })).toEqual({ error: code });
  });

  // Pins that every way turnOrder can refuse an action has an API code. `satisfies` fails to
  // compile when a reason is added to TurnRejection and not listed here.
  it.each(Object.keys(turnRejections))("accepts the turn rejection %s", (reason) => {
    expect(errorBodySchema.parse({ error: reason })).toEqual({ error: reason });
  });

  // Pins each code routes and the client rely on by name; the loop over options above only
  // proves the schema accepts its own list.
  it.each([
    "bad_request",
    "forbidden_origin",
    "not_participant",
    "already_joined",
    "not_found",
    "name_taken",
    "invalid_passage",
    "invalid_display_name",
    "ai_unavailable",
    "ai_rate_limited",
  ])("accepts the route code %s", (code) => {
    expect(errorBodySchema.parse({ error: code })).toEqual({ error: code });
  });

  it("rejects an unknown code", () => {
    expect(errorBodySchema.safeParse({ error: "teapot" }).success).toBe(false);
  });
});
