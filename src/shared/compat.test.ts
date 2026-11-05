// Fixtures under fixtures/level1/ are append-only: never edit them. A change that breaks one is a
// breaking change; bump API_LEVEL and add fixtures/level2/ instead.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  contributeRequestSchema,
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
  skipRequestSchema,
  storyViewSchema,
  suggestionsResponseSchema,
} from "./api";

const responseSchemas = {
  health: healthResponseSchema,
  createStory: createStoryResponseSchema,
  join: joinResponseSchema,
  storyView: storyViewSchema,
  myStories: myStoriesResponseSchema,
  suggestions: suggestionsResponseSchema,
  liveMessage: liveMessageSchema,
};

// emptyRequestSchema is the only strict schema, so a new field in a request would reject an old
// client; the other request schemas are tested for what a level-1 client still sends.
const requestSchemas = {
  createStory: createStoryRequestSchema,
  join: joinRequestSchema,
  contribute: contributeRequestSchema,
  skip: skipRequestSchema,
  empty: emptyRequestSchema,
};

const responseFixtures = readFixture("responses", z.record(z.string(), z.unknown()));
const requestFixtures = readFixture("requests", z.record(z.string(), z.unknown()));
const errorFixtures = readFixture("errors", z.array(z.unknown()));

describe("level 1 responses", () => {
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

  it("includes a waiting story with no holder", () => {
    const { stories } = myStoriesResponseSchema.parse(responseFixtures["myStories"]);

    expect(stories.some((story) => story.holderName === null && story.endsAt === null)).toBe(true);
  });
});

describe("level 1 errors", () => {
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

  it("still knows every code a level-1 server sends", () => {
    const codes = errorFixtures.map((body) => errorBodySchema.parse(body).error);

    for (const code of codes) {
      expect(errorCodeSchema.options).toContain(code);
    }
  });
});

describe("level 1 requests", () => {
  it("covers every request the schemas list", () => {
    expect(Object.keys(requestFixtures).toSorted()).toEqual(Object.keys(requestSchemas).toSorted());
  });

  it.each(Object.entries(requestSchemas))("still accepts the %s request", (name, schema) => {
    expect(schema.safeParse(requestFixtures[name]).success).toBe(true);
  });
});

function readFixture<T>(name: string, schema: z.ZodType<T>): T {
  const file = path.join(import.meta.dirname, "fixtures/level1", `${name}.json`);

  return schema.parse(JSON.parse(readFileSync(file, "utf8")));
}

// What a newer Worker may add to a response: a field no level-1 client knows about.
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
