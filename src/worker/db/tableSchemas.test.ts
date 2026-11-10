// Pins that every table schema and every column carries a description, read the way the
// generated docs/database.md reads it. Without it, a description left out or placed before
// `.nullable()` would print as an empty cell.
import { describe, expect, it } from "vitest";

import type { TableSchemas } from "./databaseDoc";
import { descriptionOf } from "./renderDatabaseDoc";
import { TABLE_SCHEMAS } from "./tableSchemas";

const tableSchemas: TableSchemas = TABLE_SCHEMAS;
const tables = Object.entries(tableSchemas);
const columns = tables.flatMap(([tableName, schema]) =>
  Object.entries(schema.shape).map(([key, columnSchema]) => ({
    name: `${tableName}.${key}`,
    columnSchema,
  })),
);

describe("table schema descriptions", () => {
  it.each(tables)("table %s has a description", (_tableName, schema) => {
    expect(descriptionOf(schema)).not.toBe("");
  });

  it.each(columns)("column $name has a description", ({ columnSchema }) => {
    expect(descriptionOf(columnSchema)).not.toBe("");
  });
});
