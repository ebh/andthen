import { describe, expect, it } from "vitest";

import { deviceTokenSchema } from "./deviceToken";

describe("deviceTokenSchema", () => {
  const valid = "0123456789abcdef".repeat(4);

  it("accepts 64 lowercase hex characters", () => {
    expect(deviceTokenSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["63 characters", valid.slice(1)],
    ["65 characters", `${valid}a`],
    ["uppercase hex", valid.toUpperCase()],
    ["non-hex characters", `${valid.slice(1)}g`],
    ["a trailing newline", `${valid}\n`],
  ])("rejects %s", (_name, value) => {
    expect(deviceTokenSchema.safeParse(value).success).toBe(false);
  });
});
