import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAnonymousUser, findUserByBrowserTokenHash } from "../src/worker/db/userRepo";
import { createTestEnv, type TestEnv } from "./support/testEnv";

describe("userRepo", () => {
  let testEnv: TestEnv;
  let db: Env["DB"];

  beforeAll(async () => {
    testEnv = await createTestEnv();
    db = testEnv.env.DB;
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("finds the user a browser token hash names, and null for an unknown one", async () => {
    const created = await createAnonymousUser(db, {
      id: "u1",
      browserTokenHash: "h1",
      createdAt: 1,
    });

    expect(created).toEqual({ id: "u1" });
    expect(await findUserByBrowserTokenHash(db, "h1")).toEqual({ id: "u1" });
    expect(await findUserByBrowserTokenHash(db, "unknown")).toBeNull();
  });

  it("returns the existing user when another request created one for the hash first", async () => {
    await createAnonymousUser(db, { id: "first", browserTokenHash: "race", createdAt: 1 });

    const second = await createAnonymousUser(db, {
      id: "second",
      browserTokenHash: "race",
      createdAt: 2,
    });

    expect(second).toEqual({ id: "first" });
    const stored = await db.prepare("SELECT id FROM users WHERE browser_token_hash = 'race'").all();
    expect(stored.results).toEqual([{ id: "first" }]);
  });
});
