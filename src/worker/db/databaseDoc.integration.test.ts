// Pins that the table schemas in tableSchemas.ts describe the migrated D1 database exactly.
// Without it, a migration that adds, changes or drops a column passes every other test while the
// Zod schemas that the repositories infer their types from go stale.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestEnv, type TestEnv } from "../../../test/support/testEnv";
import { findSchemaDrift, readDatabaseColumns } from "./databaseDoc";
import { TABLE_SCHEMAS } from "./tableSchemas";

describe("the migrated database", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("matches the table schemas", async () => {
    const columns = await readDatabaseColumns(testEnv.env.DB);

    expect(findSchemaDrift(columns, TABLE_SCHEMAS)).toEqual([]);
  });
});
