import { describe, expect, it } from "vitest";

import { describeFailure } from "./messages";

const GENERIC = "Something went wrong. Please try again.";

describe("describeFailure", () => {
  it("explains a network failure", () => {
    expect(describeFailure({ type: "network" })).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it("uses the screen's wording for a code it expects, else the generic message", () => {
    const failure = { type: "rejected", status: 409, code: "name_taken" } as const;

    expect(describeFailure(failure, { name_taken: "Taken." })).toBe("Taken.");
    expect(describeFailure(failure)).toBe(GENERIC);
  });

  it("uses the generic message for a code from a newer Worker", () => {
    expect(describeFailure({ type: "unknown_code", status: 418, code: "made_up" })).toBe(GENERIC);
  });

  it("tells an outdated client to reload", () => {
    expect(describeFailure({ type: "client_outdated" })).toBe(
      "This version of the app is out of date. Reload the page to update.",
    );
  });
});
