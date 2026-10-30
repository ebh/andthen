import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { healthResponseSchema } from "../src/shared/api";
import { app } from "../src/worker/app";
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("GET /api/health", () => {
  let testEnv: TestEnv;

  beforeAll(async () => {
    testEnv = await createTestEnv();
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("answers ok once D1 responds", async () => {
    const response = await app.request("/api/health", {}, testEnv.env);

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: "ok" });
  });

  it("runs against a D1 with the migrations applied", async () => {
    const tables = await testEnv.env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name",
    ).all();

    expect(tables.results).toEqual([
      { name: "contributions" },
      { name: "participants" },
      { name: "stories" },
      { name: "suggestion_requests" },
    ]);
  });
});
