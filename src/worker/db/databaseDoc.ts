import { z } from "zod";

import {
  databaseColumnRowSchema,
  foreignKeyRowSchema,
  indexColumnRowSchema,
  indexRowSchema,
  tableSqlRowSchema,
  type DatabaseColumnRow,
  type ForeignKeyRow,
  type IndexColumnRow,
  type IndexRow,
  type TableSqlRow,
} from "./rows";
import type { Db } from "./storyRepo";

/** The Zod object that describes one table, with each column key typed. */
export type TableSchema = z.ZodObject<Record<string, z.core.$ZodType>>;

/** A map from SQL table name to its table schema. */
export type TableSchemas = Readonly<Record<string, TableSchema>>;

// D1 keeps its own bookkeeping tables beside ours; GLOB (unlike LIKE) reads `_` literally.
const MIGRATED_TABLES_WHERE = `m.type = 'table'
    AND m.name NOT GLOB 'sqlite_*' AND m.name NOT GLOB '_cf_*' AND m.name <> 'd1_migrations'`;

// The row order of a pragma is not defined, so every query sorts explicitly.
const COLUMNS_QUERY = `
  SELECT m.name AS tableName, p.cid AS cid, p.name AS name, p.type AS type,
         p."notnull" AS "notNull", p.dflt_value AS defaultValue, p.pk AS primaryKey
  FROM sqlite_master m JOIN pragma_table_info(m.name) p
  WHERE ${MIGRATED_TABLES_WHERE}
  ORDER BY m.name, p.cid`;

const FOREIGN_KEYS_QUERY = `
  SELECT m.name AS tableName, f."table" AS parentTable, f."from" AS fromColumn, f.seq AS seq
  FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
  WHERE ${MIGRATED_TABLES_WHERE}
  ORDER BY m.name, f."from"`;

// key = 1 drops the trailing rowid entry that xinfo adds to every index.
const INDEX_COLUMNS_QUERY = `
  SELECT m.name AS tableName, i.name AS name, i."unique" AS "unique", i.origin AS origin,
         i.partial AS partial, s.sql AS sql, x.seqno AS seqno, x.name AS columnName,
         x.desc AS descending, x.coll AS collation
  FROM sqlite_master m
    JOIN pragma_index_list(m.name) i
    JOIN pragma_index_xinfo(i.name) x
    LEFT JOIN sqlite_master s ON s.type = 'index' AND s.name = i.name
  WHERE ${MIGRATED_TABLES_WHERE} AND x.key = 1
  ORDER BY m.name, i.name, x.seqno`;

const TABLE_SQL_QUERY = `
  SELECT m.name AS tableName, m.sql AS sql
  FROM sqlite_master m
  WHERE ${MIGRATED_TABLES_WHERE}
  ORDER BY m.name`;

/** Every column of every table the migrations create, in table-name then column order. */
export async function readDatabaseColumns(db: Db): Promise<DatabaseColumnRow[]> {
  const result = await db.prepare(COLUMNS_QUERY).all();

  return z.array(databaseColumnRowSchema).parse(result.results);
}

/** Every foreign key column, in table-name then column-name order. */
export async function readForeignKeys(db: Db): Promise<ForeignKeyRow[]> {
  const result = await db.prepare(FOREIGN_KEYS_QUERY).all();

  const foreignKeys = z.array(foreignKeyRowSchema).parse(result.results);
  foreignKeys.forEach(assertSimpleForeignKey);

  return foreignKeys;
}

/** Every index, in table-name then index-name order, with its columns in index order. */
export async function readIndexes(db: Db): Promise<IndexRow[]> {
  const result = await db.prepare(INDEX_COLUMNS_QUERY).all();
  const columnRows = z.array(indexColumnRowSchema).parse(result.results);
  const rowsByIndex = Map.groupBy(columnRows, (row) => `${row.tableName}.${row.name}`);

  return [...rowsByIndex.values()].map(indexFromColumnRows);
}

/** The reference lists one column per foreign key, so a composite key is refused, not misdrawn. */
export function assertSimpleForeignKey(foreignKey: ForeignKeyRow): void {
  if (foreignKey.seq > 0) {
    throw new Error(
      `foreign key ${foreignKey.tableName}.${foreignKey.fromColumn} is part of a composite key, which is not supported`,
    );
  }
}

/**
 * One index from its column rows, in index order. The reference lists plain ascending columns
 * with the default collation, so any other column is refused rather than described wrongly.
 */
export function indexFromColumnRows(rows: IndexColumnRow[]): IndexRow {
  const columns = rows.map((row) => {
    const label = `index ${row.name} on table ${row.tableName}`;
    if (row.columnName === null) {
      throw new Error(`${label} has an expression column, which is not supported`);
    }
    if (row.descending === 1) {
      throw new Error(`${label} sorts column ${row.columnName} descending, which is not supported`);
    }
    if (row.collation !== "BINARY") {
      throw new Error(
        `${label} uses collation ${row.collation} on column ${row.columnName}, which is not supported`,
      );
    }

    return row.columnName;
  });

  return indexRowSchema.parse({ ...rows[0], columns });
}

/** The CREATE TABLE statement of every table, in table-name order. */
export async function readTableSql(db: Db): Promise<TableSqlRow[]> {
  const result = await db.prepare(TABLE_SQL_QUERY).all();

  return z.array(tableSqlRowSchema).parse(result.results);
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
  const required = isRequired(column);
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

/** A primary key counts as required, though SQLite lets a non-INTEGER one hold NULL. */
export function isRequired(column: DatabaseColumnRow): boolean {
  return column.notNull === 1 || column.primaryKey > 0;
}

export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}
