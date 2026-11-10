import { describe, expect, it } from "vitest";

import { NAME_FAILURE_MESSAGES, describeFailure, describeNameProblem } from "./messages";

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

describe("describeNameProblem", () => {
  it.each([
    ["empty", "Enter a name."],
    ["too_long", "Names can be at most 40 characters."],
  ] as const)("words %s", (problem, message) => {
    expect(describeNameProblem(problem)).toBe(message);
  });
});

describe("NAME_FAILURE_MESSAGES", () => {
  it("suggests signing in when a name is taken, in case it is the user's own", () => {
    expect(NAME_FAILURE_MESSAGES.name_taken).toContain("sign in");
  });

  it("asks the user to check their name when the form's view of it was out of date", () => {
    expect(NAME_FAILURE_MESSAGES.invalid_display_name).toBe("Check your name and try again.");
    expect(NAME_FAILURE_MESSAGES.bad_request).toBe("Check your name and try again.");
  });
});
