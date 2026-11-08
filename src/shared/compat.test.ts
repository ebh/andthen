// Fixtures under fixtures/levelN/ are append-only: never edit them. A change that breaks one is a
// breaking change; bump API_LEVEL and add fixtures/level(N+1)/ instead. Level 2 holds the messages
// of the current API. Level 1 stays so that this file shows what level 2 changed.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  contributeRequestSchema,
  contributeResponseSchema,
  createStoryRequestSchema,
  createStoryResponseSchema,
  emptyRequestSchema,
  errorBodySchema,
  errorCodeSchema,
  healthResponseSchema,
  joinRequestSchema,
  joinResponseSchema,
  liveMessageSchema,
  myStoriesResponseSchema,
  pushSubscriptionSchema,
  skipRequestSchema,
  storyViewSchema,
  suggestionsResponseSchema,
} from "./api";

const responseSchemas = {
  health: healthResponseSchema,
  createStory: createStoryResponseSchema,
  join: joinResponseSchema,
  contribute: contributeResponseSchema,
  storyView: storyViewSchema,
  myStories: myStoriesResponseSchema,
  suggestions: suggestionsResponseSchema,
  liveMessage: liveMessageSchema,
};

// emptyRequestSchema is the only strict schema, so a new field in a request would reject an old
// client; the other request schemas are tested for what a client of the level still sends.
const requestSchemas = {
  createStory: createStoryRequestSchema,
  join: joinRequestSchema,
  contribute: contributeRequestSchema,
  skip: skipRequestSchema,
  pushSubscription: pushSubscriptionSchema,
  empty: emptyRequestSchema,
};

const responseFixtures = readFixture(2, "responses", z.record(z.string(), z.unknown()));
const requestFixtures = readFixture(2, "requests", z.record(z.string(), z.unknown()));
const errorFixtures = readFixture(2, "errors", z.array(z.unknown()));

describe("level 2 responses", () => {
  it("covers every response the schemas list", () => {
    expect(Object.keys(responseFixtures).toSorted()).toEqual(
      Object.keys(responseSchemas).toSorted(),
    );
  });

  it.each(Object.entries(responseSchemas))("still parses the %s fixture", (name, schema) => {
    expect(schema.safeParse(responseFixtures[name]).success).toBe(true);
  });

  it.each(Object.entries(responseSchemas))(
    "still parses the %s fixture with fields added to every object",
    (name, schema) => {
      expect(schema.safeParse(withAddedFields(responseFixtures[name])).success).toBe(true);
    },
  );

  it("includes a waiting story with no holder, and a page with a cursor", () => {
    const { stories, nextCursor } = myStoriesResponseSchema.parse(responseFixtures["myStories"]);

    expect(stories.some((story) => story.holderName === null && story.endsAt === null)).toBe(true);
    expect(nextCursor).not.toBeNull();
  });
});

describe("level 2 errors", () => {
  it("has one fixture per code", () => {
    const codes = errorFixtures.map((body) => errorBodySchema.parse(body).error);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes client_outdated and left_story with its extra fields", () => {
    const bodies = errorFixtures.map((body) => errorBodySchema.parse(body));

    expect(bodies).toContainEqual({ error: "client_outdated" });
    expect(bodies).toContainEqual({
      error: "left_story",
      displayName: "Ana",
      opening: "Once upon a time.",
    });
  });

  it.each(errorFixtures.map((body, index) => [index, body]))(
    "still parses error fixture %d, also with fields added",
    (_index, body) => {
      expect(errorBodySchema.safeParse(body).success).toBe(true);
      expect(errorBodySchema.safeParse(withAddedFields(body)).success).toBe(true);
    },
  );

  it("knows every code the API sends", () => {
    const codes = errorFixtures.map((body) => errorBodySchema.parse(body).error);

    expect(codes.toSorted()).toEqual(errorCodeSchema.options.toSorted());
  });
});

describe("level 2 requests", () => {
  it("covers every request the schemas list", () => {
    expect(Object.keys(requestFixtures).toSorted()).toEqual(Object.keys(requestSchemas).toSorted());
  });

  it.each(Object.entries(requestSchemas))("still accepts the %s request", (name, schema) => {
    expect(schema.safeParse(requestFixtures[name]).success).toBe(true);
  });
});

describe("what level 2 changed from level 1", () => {
  const level1Responses = readFixture(1, "responses", z.record(z.string(), z.unknown()));
  const level1Requests = readFixture(1, "requests", z.record(z.string(), z.unknown()));
  const level1Errors = readFixture(1, "errors", z.array(z.unknown()));

  it("lists no level-1 response as unreadable except the list of stories, which gained nextCursor", () => {
    const unreadable = Object.entries(responseSchemas)
      .filter(([name]) => name in level1Responses)
      .filter(([name, schema]) => !schema.safeParse(level1Responses[name]).success)
      .map(([name]) => name);

    expect(unreadable).toEqual(["myStories"]);
  });

  it("still accepts every level-1 request", () => {
    const refused = Object.entries(requestSchemas)
      .filter(([name]) => name in level1Requests)
      .filter(([name, schema]) => !schema.safeParse(level1Requests[name]).success)
      .map(([name]) => name);

    expect(refused).toEqual([]);
  });

  it("still parses every level-1 error", () => {
    for (const body of level1Errors) {
      expect(errorBodySchema.safeParse(body).success).toBe(true);
    }
  });
});

function readFixture<T>(level: number, name: string, schema: z.ZodType<T>): T {
  const file = path.join(import.meta.dirname, `fixtures/level${String(level)}`, `${name}.json`);

  return schema.parse(JSON.parse(readFileSync(file, "utf8")));
}

// What a newer Worker may add to a response: a field no client of the level knows about.
function withAddedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withAddedFields);
  }
  if (typeof value === "object" && value !== null) {
    const fields = Object.entries(value).map(([key, field]) => [key, withAddedFields(field)]);

    return { ...Object.fromEntries(fields), addedLater: true };
  }

  return value;
}
