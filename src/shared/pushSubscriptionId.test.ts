import { describe, expect, it } from "vitest";

import { pushSubscriptionIdOf } from "./pushSubscriptionId";

describe("pushSubscriptionIdOf", () => {
  it("is the SHA-256 of the endpoint in lowercase hex", async () => {
    expect(await pushSubscriptionIdOf("https://fcm.googleapis.com/send/one")).toBe(
      "eede65f7cc74374d0ae524cdec60a0b4a463bdf1ef3d7961643d2eec70eef886",
    );
  });

  it("differs for endpoints that differ by one character", async () => {
    expect(await pushSubscriptionIdOf("https://fcm.googleapis.com/send/a")).not.toBe(
      await pushSubscriptionIdOf("https://fcm.googleapis.com/send/b"),
    );
  });
});
