import { describe, expect, it } from "vitest";
import { z } from "zod";

import { findSchemaDrift } from "./databaseDoc";
import type { DatabaseColumnRow } from "./rows";

function column(overrides: Partial<DatabaseColumnRow> & { name: string }): DatabaseColumnRow {
  return {
    tableName: "things",
    cid: 0,
    type: "TEXT",
    notNull: 1,
    defaultValue: null,
    primaryKey: 0,
    ...overrides,
  };
}

describe("findSchemaDrift", () => {
  it("reports nothing when the schemas and the database agree", () => {
    const columns = [
      column({ name: "id" }),
      column({ name: "created_at", type: "INTEGER" }),
      column({ name: "left_at", type: "INTEGER", notNull: 0 }),
      column({ name: "flag", type: "INTEGER" }),
      column({ name: "note", notNull: 0 }),
    ];
    const schemas = {
      things: z.object({
        id: z.string().min(1),
        createdAt: z.number().int().nonnegative(),
        leftAt: z.number().nullable(),
        flag: z.union([z.literal(0), z.literal(1)]),
        note: z.string().nullable(),
      }),
    };

    expect(findSchemaDrift(columns, schemas)).toEqual([]);
  });

  it("names a table that has no table schema", () => {
    const columns = [column({ name: "id" })];

    expect(findSchemaDrift(columns, {})).toEqual(["table things has no table schema"]);
  });

  it("names a table schema that has no table", () => {
    const schemas = { ghosts: z.object({}) };

    expect(findSchemaDrift([], schemas)).toEqual([
      "table schema ghosts has no table in the database",
    ]);
  });

  it("names a column that has no schema key", () => {
    const columns = [column({ name: "id" }), column({ name: "extra_note" })];
    const schemas = { things: z.object({ id: z.string() }) };

    expect(findSchemaDrift(columns, schemas)).toEqual([
      "column things.extra_note has no key in the table schema",
    ]);
  });

  it("names a schema key that has no column", () => {
    const columns = [column({ name: "id" })];
    const schemas = { things: z.object({ id: z.string(), missingKey: z.string() }) };

    expect(findSchemaDrift(columns, schemas)).toEqual([
      "schema key things.missingKey has no column in the table",
    ]);
  });

  it("matches a column with several underscores to its camelCase key", () => {
    const columns = [column({ name: "last_seen_at_ms" }), column({ name: "p256dh_key_2" })];
    const schemas = { things: z.object({ lastSeenAtMs: z.string(), p256dhKey2: z.string() }) };

    expect(findSchemaDrift(columns, schemas)).toEqual([]);
  });

  it("reports a NOT NULL column whose schema is nullable", () => {
    const columns = [column({ name: "id", notNull: 1 })];
    const schemas = { things: z.object({ id: z.string().nullable() }) };

    expect(findSchemaDrift(columns, schemas)).toEqual([
      "column things.id is NOT NULL or a primary key but its schema is nullable",
    ]);
  });

  it("accepts a non-nullable schema on a primary key that SQLite reports as nullable", () => {
    const columns = [column({ name: "id", notNull: 0, primaryKey: 1 })];

    expect(findSchemaDrift(columns, { things: z.object({ id: z.string() }) })).toEqual([]);
  });

  it("reports a nullable schema on a primary key that SQLite reports as nullable", () => {
    const columns = [column({ name: "id", notNull: 0, primaryKey: 1 })];

    expect(findSchemaDrift(columns, { things: z.object({ id: z.string().nullable() }) })).toEqual([
      "column things.id is NOT NULL or a primary key but its schema is nullable",
    ]);
  });

  it("reports a nullable column whose schema is not nullable", () => {
    const columns = [column({ name: "id", notNull: 0 })];
    const schemas = { things: z.object({ id: z.string() }) };

    expect(findSchemaDrift(columns, schemas)).toEqual([
      "column things.id allows NULL but its schema is not nullable",
    ]);
  });

  it.each([
    ["a number", z.number().int()],
    ["a literal number", z.literal(1)],
    ["a literal of several numbers", z.literal([0, 1])],
    ["a union of number literals", z.union([z.literal(0), z.literal(1)])],
    ["a union of a number and a number literal", z.union([z.number(), z.literal(1)])],
  ])("accepts an INTEGER column whose schema is %s", (_name, idSchema) => {
    const columns = [column({ name: "id", type: "INTEGER" })];

    expect(findSchemaDrift(columns, { things: z.object({ id: idSchema }) })).toEqual([]);
  });

  it.each([
    ["a string", z.string()],
    ["an enum", z.enum(["a", "b"])],
    ["a union of string literals", z.union([z.literal("a"), z.literal("b")])],
    ["a literal string", z.literal("a")],
    ["a literal of several strings", z.literal(["a", "b"])],
    ["a union of an enum and a string literal", z.union([z.enum(["a", "b"]), z.literal("c")])],
  ])("accepts a TEXT column whose schema is %s", (_name, idSchema) => {
    const columns = [column({ name: "id", type: "TEXT" })];

    expect(findSchemaDrift(columns, { things: z.object({ id: idSchema }) })).toEqual([]);
  });

  it.each([
    ["a string", z.string(), 1],
    ["a nullable string", z.string().nullable(), 0],
    ["an enum", z.enum(["a", "b"]), 1],
    ["a union of string literals", z.union([z.literal("a"), z.literal("b")]), 1],
    ["a union mixing number and string literals", z.union([z.literal(0), z.literal("a")]), 1],
    ["a literal of mixed values", z.literal([1, "a"]), 1],
    ["a union holding a literal of mixed values", z.union([z.literal(0), z.literal([1, "a"])]), 1],
    ["a union of non-literals", z.union([z.number(), z.string()]), 1],
  ] as const)("reports an INTEGER column whose schema is %s", (_name, idSchema, notNull) => {
    const columns = [column({ name: "id", type: "INTEGER", notNull })];

    expect(findSchemaDrift(columns, { things: z.object({ id: idSchema }) })).toEqual([
      "column things.id is INTEGER but its schema is not a number",
    ]);
  });

  it.each([
    ["a number", z.number()],
    ["a literal number", z.literal(1)],
    ["a literal of mixed values", z.literal([1, "a"])],
    ["a union mixing number and string literals", z.union([z.literal(0), z.literal("a")])],
    ["a union of a number and a string", z.union([z.number(), z.string()])],
  ])("reports a TEXT column whose schema is %s", (_name, idSchema) => {
    const columns = [column({ name: "id", type: "TEXT" })];

    expect(findSchemaDrift(columns, { things: z.object({ id: idSchema }) })).toEqual([
      "column things.id is TEXT but its schema is not a string",
    ]);
  });

  it("reports a column type the check does not cover", () => {
    const columns = [column({ name: "blob", type: "BLOB" })];
    const schemas = { things: z.object({ blob: z.string() }) };

    expect(findSchemaDrift(columns, schemas)).toEqual([
      "column things.blob has SQLite type BLOB, which this check does not cover",
    ]);
  });

  it("accepts a nullable column whose schema is a nullable number", () => {
    const columns = [column({ name: "n", type: "INTEGER", notNull: 0 })];
    const schemas = { things: z.object({ n: z.number().nullable() }) };

    expect(findSchemaDrift(columns, schemas)).toEqual([]);
  });

  it("returns every problem across tables, sorted", () => {
    const columns = [
      column({ tableName: "zebras", name: "id" }),
      column({ tableName: "apes", name: "id", notNull: 0 }),
    ];
    const schemas = { apes: z.object({ id: z.string() }), mice: z.object({}) };

    expect(findSchemaDrift(columns, schemas)).toEqual([
      "column apes.id allows NULL but its schema is not nullable",
      "table schema mice has no table in the database",
      "table zebras has no table schema",
    ]);
  });
});
