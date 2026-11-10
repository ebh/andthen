import { z } from "zod";

import { databaseColumnRowSchema, type DatabaseColumnRow } from "./rows";
import type { Db } from "./storyRepo";

/** The Zod object that describes one table, with each column key typed. */
export type TableSchema = z.ZodObject<Record<string, z.core.$ZodType>>;

/** A map from SQL table name to its table schema. */
export type TableSchemas = Readonly<Record<string, TableSchema>>;

// D1 keeps its own bookkeeping tables beside ours; GLOB (unlike LIKE) reads `_` literally.
const COLUMNS_QUERY = `
  SELECT m.name AS tableName, p.cid AS cid, p.name AS name, p.type AS type,
         p."notnull" AS "notNull", p.dflt_value AS defaultValue, p.pk AS primaryKey
  FROM sqlite_master m JOIN pragma_table_info(m.name) p
  WHERE m.type = 'table'
    AND m.name NOT GLOB 'sqlite_*' AND m.name NOT GLOB '_cf_*' AND m.name <> 'd1_migrations'
  ORDER BY m.name, p.cid`;

/** Every column of every table the migrations create, in table-name then column order. */
export async function readDatabaseColumns(db: Db): Promise<DatabaseColumnRow[]> {
  const result = await db.prepare(COLUMNS_QUERY).all();

  return z.array(databaseColumnRowSchema).parse(result.results);
}

/** Plain-English problems, sorted; empty when the table schemas describe the database exactly. */
export function findSchemaDrift(
  columns: DatabaseColumnRow[],
  tableSchemas: TableSchemas,
): string[] {
  const columnsByTable = Map.groupBy(columns, (column) => column.tableName);
  const problems: string[] = [];

  for (const [tableName, tableColumns] of columnsByTable) {
    const schema = tableSchemas[tableName];
    if (schema === undefined) {
      problems.push(`table ${tableName} has no table schema`);
    } else {
      problems.push(...findTableDrift(tableName, tableColumns, schema));
    }
  }
  for (const tableName of Object.keys(tableSchemas)) {
    if (!columnsByTable.has(tableName)) {
      problems.push(`table schema ${tableName} has no table in the database`);
    }
  }

  return problems.toSorted();
}

function findTableDrift(
  tableName: string,
  columns: DatabaseColumnRow[],
  schema: TableSchema,
): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();

  for (const column of columns) {
    const key = snakeToCamel(column.name);
    keys.add(key);
    const columnSchema = schema.shape[key];
    if (columnSchema === undefined) {
      problems.push(`column ${tableName}.${column.name} has no key in the table schema`);
    } else {
      problems.push(...findColumnDrift(`${tableName}.${column.name}`, column, columnSchema));
    }
  }
  for (const key of Object.keys(schema.shape)) {
    if (!keys.has(key)) {
      problems.push(`schema key ${tableName}.${key} has no column in the table`);
    }
  }

  return problems;
}

function findColumnDrift(
  label: string,
  column: DatabaseColumnRow,
  schema: z.core.$ZodType,
): string[] {
  const problems: string[] = [];
  // SQLite lets a non-INTEGER primary key hold NULL, so pragma reports notnull 0 for it.
  const required = column.notNull === 1 || column.primaryKey > 0;
  const nullable = schema instanceof z.ZodNullable;
  const base = schema instanceof z.ZodNullable ? schema.unwrap() : schema;

  if (required && nullable) {
    problems.push(`column ${label} is NOT NULL or a primary key but its schema is nullable`);
  }
  if (!required && !nullable) {
    problems.push(`column ${label} allows NULL but its schema is not nullable`);
  }

  if (column.type === "INTEGER") {
    if (!isNumeric(base)) {
      problems.push(`column ${label} is INTEGER but its schema is not a number`);
    }
  } else if (column.type === "TEXT") {
    if (!isText(base)) {
      problems.push(`column ${label} is TEXT but its schema is not a string`);
    }
  } else {
    problems.push(
      `column ${label} has SQLite type ${column.type}, which this check does not cover`,
    );
  }

  return problems;
}

/** A number, a literal of numbers, or a union of those such as a 0/1 flag. */
function isNumeric(schema: z.core.$ZodType): boolean {
  return (
    schema instanceof z.ZodNumber ||
    isLiteralOf("number", schema) ||
    (schema instanceof z.ZodUnion && schema.options.every(isNumeric))
  );
}

/** A string, an enum, a literal of strings, or a union of those. */
function isText(schema: z.core.$ZodType): boolean {
  return (
    schema instanceof z.ZodString ||
    schema instanceof z.ZodEnum ||
    isLiteralOf("string", schema) ||
    (schema instanceof z.ZodUnion && schema.options.every(isText))
  );
}

function isLiteralOf(type: "number" | "string", schema: z.core.$ZodType): boolean {
  return (
    schema instanceof z.ZodLiteral && [...schema.values].every((value) => typeof value === type)
  );
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}
