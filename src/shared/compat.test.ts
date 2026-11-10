// Fixtures under fixtures/levelN/ are append-only: never edit them. A change that breaks one is a
// breaking change; bump API_LEVEL and add fixtures/level(N+1)/ instead. Level 3 holds the messages
// of the current API. Level 2 stays so that this file shows what level 3 changed.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  blocksResponseSchema,
  blockUserRequestSchema,
  blockUserResponseSchema,
  createPassageRequestSchema,
  createPassageResponseSchema,
  createStoryRequestSchema,
  createStoryResponseSchema,
  emptyRequestSchema,
  errorBodySchema,
  errorCodeSchema,
  healthResponseSchema,
  joinRequestSchema,
  joinResponseSchema,
  liveMessageSchema,
  meResponseSchema,
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
  createPassage: createPassageResponseSchema,
  me: meResponseSchema,
  storyView: storyViewSchema,
  myStories: myStoriesResponseSchema,
  myStoriesWithOpeningAuthor: myStoriesResponseSchema,
  suggestions: suggestionsResponseSchema,
  liveMessage: liveMessageSchema,
  blockUser: blockUserResponseSchema,
  blocks: blocksResponseSchema,
};

// emptyRequestSchema is the only strict schema, so a new field in a request would reject an old
// client; the other request schemas are tested for what a client of the level still sends.
const requestSchemas = {
  createStory: createStoryRequestSchema,
  join: joinRequestSchema,
  createPassage: createPassageRequestSchema,
  skip: skipRequestSchema,
  pushSubscription: pushSubscriptionSchema,
  empty: emptyRequestSchema,
  blockUser: blockUserRequestSchema,
};

const responseFixtures = readFixture(3, "responses", z.record(z.string(), z.unknown()));
const requestFixtures = readFixture(3, "requests", z.record(z.string(), z.unknown()));
const errorFixtures = readFixture(3, "errors", z.array(z.unknown()));

describe("level 3 responses", () => {
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

describe("level 3 errors", () => {
  it("has one fixture per code, except left_story, recorded with and without openingAuthorId", () => {
    const codes = errorFixtures.map((body) => errorBodySchema.parse(body).error);

    expect(codes.filter((code) => code === "left_story")).toHaveLength(2);
    expect(new Set(codes).size).toBe(codes.length - 1);
  });

  it("includes client_outdated and left_story with its extra fields", () => {
    const bodies = errorFixtures.map((body) => errorBodySchema.parse(body));

    expect(bodies).toContainEqual({ error: "client_outdated" });
    expect(bodies).toContainEqual({
      error: "left_story",
      displayName: "Ana",
      opening: "Once upon a time.",
    });
    expect(bodies).toContainEqual({
      error: "left_story",
      displayName: "Ana",
      opening: "Once upon a time.",
      openingAuthorId: "u1",
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
    const codes = new Set(errorFixtures.map((body) => errorBodySchema.parse(body).error));

    expect([...codes].toSorted()).toEqual(errorCodeSchema.options.toSorted());
  });
});

describe("level 3 requests", () => {
  it("covers every request the schemas list", () => {
    expect(Object.keys(requestFixtures).toSorted()).toEqual(Object.keys(requestSchemas).toSorted());
  });

  it.each(Object.entries(requestSchemas))("still accepts the %s request", (name, schema) => {
    expect(schema.safeParse(requestFixtures[name]).success).toBe(true);
  });
});

describe("what level 3 changed from level 2", () => {
  // Level 3 renamed the route that adds a passage; its level-2 messages sit under the old name.
  const level2Name: { [name: string]: string } = { createPassage: "contribute" };
  const level2Responses = readFixture(2, "responses", z.record(z.string(), z.unknown()));
  const level2Requests = readFixture(2, "requests", z.record(z.string(), z.unknown()));
  const level2Errors = readFixture(2, "errors", z.array(z.unknown()));

  function level2Fixture(fixtures: { [name: string]: unknown }, name: string): unknown {
    return fixtures[level2Name[name] ?? name];
  }

  it("lists only the story, which gained passages and userId, and the passage's ID as unreadable", () => {
    const unreadable = Object.entries(responseSchemas)
      .filter(([name]) => (level2Name[name] ?? name) in level2Responses)
      .filter(([name, schema]) => !schema.safeParse(level2Fixture(level2Responses, name)).success)
      .map(([name]) => name);

    expect(unreadable.toSorted()).toEqual(["createPassage", "storyView"]);
  });

  it("still accepts every level-2 request", () => {
    const refused = Object.entries(requestSchemas)
      .filter(([name]) => (level2Name[name] ?? name) in level2Requests)
      .filter(([name, schema]) => !schema.safeParse(level2Fixture(level2Requests, name)).success)
      .map(([name]) => name);

    expect(refused).toEqual([]);
  });

  it("still parses every level-2 error", () => {
    for (const body of level2Errors) {
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
