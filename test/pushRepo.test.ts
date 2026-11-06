import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteGonePushSubscription,
  deletePushSubscription,
  loadPushSubscriptions,
  savePushSubscription,
} from "../src/worker/db/pushRepo";
import { createTestEnv, type TestEnv } from "./support/testEnv";

const subscription = (endpoint: string, browserTokenHash: string, createdAt: number) => ({
  endpoint,
  browserTokenHash,
  p256dh: `key-${endpoint}`,
  auth: `auth-${endpoint}`,
  createdAt,
});

const row = (endpoint: string) => ({
  endpoint,
  p256dh: `key-${endpoint}`,
  auth: `auth-${endpoint}`,
});

describe("pushRepo", () => {
  let testEnv: TestEnv;
  let db: Env["DB"];

  beforeAll(async () => {
    testEnv = await createTestEnv();
    db = testEnv.env.DB;
  });

  afterAll(async () => {
    await testEnv.dispose();
  });

  it("loads a browser's subscriptions, oldest first, and no one else's", async () => {
    await savePushSubscription(db, subscription("https://push.test/b", "load", 2));
    await savePushSubscription(db, subscription("https://push.test/a", "load", 1));
    await savePushSubscription(db, subscription("https://push.test/other", "someone-else", 1));

    expect(await loadPushSubscriptions(db, "load")).toEqual([
      row("https://push.test/a"),
      row("https://push.test/b"),
    ]);
    expect(await loadPushSubscriptions(db, "nobody")).toEqual([]);
  });

  it("replaces the keys and owner of a stored endpoint but keeps its first created_at", async () => {
    await savePushSubscription(db, subscription("https://push.test/same", "first", 1));
    await savePushSubscription(db, {
      ...subscription("https://push.test/same", "second", 99),
      p256dh: "new-key",
      auth: "new-auth",
    });

    expect(await loadPushSubscriptions(db, "first")).toEqual([]);
    expect(await loadPushSubscriptions(db, "second")).toEqual([
      { endpoint: "https://push.test/same", p256dh: "new-key", auth: "new-auth" },
    ]);
    const stored = await db
      .prepare("SELECT created_at FROM push_subscriptions WHERE endpoint = ?")
      .bind("https://push.test/same")
      .all();
    expect(stored.results).toEqual([{ created_at: 1 }]);
  });

  it("deletes a subscription only for the browser that owns it", async () => {
    await savePushSubscription(db, subscription("https://push.test/mine", "owner", 1));

    await deletePushSubscription(db, "intruder", "https://push.test/mine");
    expect(await loadPushSubscriptions(db, "owner")).toHaveLength(1);

    await deletePushSubscription(db, "owner", "https://push.test/mine");
    expect(await loadPushSubscriptions(db, "owner")).toEqual([]);
  });

  it("deletes a gone subscription whoever owned it", async () => {
    await savePushSubscription(db, subscription("https://push.test/gone", "any", 1));

    await deleteGonePushSubscription(db, "https://push.test/gone");

    expect(await loadPushSubscriptions(db, "any")).toEqual([]);
  });
});
