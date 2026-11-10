// Pins that the table schemas in tableSchemas.ts describe the migrated D1 database exactly, and
// that docs/database.md is what those schemas and the database generate. Without it, a migration
// that adds, changes or drops a column passes every other test while the Zod schemas that the
// repositories infer their types from, and the reference, go stale.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestEnv, type TestEnv } from "../../../test/support/testEnv";
import {
  findSchemaDrift,
  readDatabaseColumns,
  readForeignKeys,
  readIndexes,
  readTableSql,
} from "./databaseDoc";
import { renderDatabaseDoc } from "./renderDatabaseDoc";
import { TABLE_SCHEMAS } from "./tableSchemas";

const DOC_PATH = path.join(import.meta.dirname, "../../../docs/database.md");
// `pnpm db:docs` sets this to rewrite the committed reference instead of checking it.
const WRITE_DATABASE_DOC = process.env["WRITE_DATABASE_DOC"] === "1";

describe("the migrated database", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  async function renderDoc(): Promise<string> {
    const db = testEnv.env.DB;
    const [columns, foreignKeys, indexes, tableSql] = await Promise.all([
      readDatabaseColumns(db),
      readForeignKeys(db),
      readIndexes(db),
      readTableSql(db),
    ]);

    return renderDatabaseDoc({ columns, foreignKeys, indexes, tableSql }, TABLE_SCHEMAS);
  }

  it("matches the table schemas", async () => {
    const columns = await readDatabaseColumns(testEnv.env.DB);

    expect(findSchemaDrift(columns, TABLE_SCHEMAS)).toEqual([]);
  });

  it.skipIf(WRITE_DATABASE_DOC)("has a committed docs/database.md that is up to date", async () => {
    const committed = await readFile(DOC_PATH, "utf8");

    expect(committed, "docs/database.md is stale: run `pnpm db:docs` and commit it").toBe(
      await renderDoc(),
    );
  });

  it.runIf(WRITE_DATABASE_DOC)("writes docs/database.md", async () => {
    const doc = await renderDoc();

    await writeFile(DOC_PATH, doc);

    expect(await readFile(DOC_PATH, "utf8")).toBe(doc);
  });
});
