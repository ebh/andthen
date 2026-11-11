import { describe, expect, it } from "vitest";

import type { ApiFailure } from "./api";
import { suggestionsOutcome } from "./suggestions";

describe("suggestionsOutcome", () => {
  it("shows the suggestions when the request worked", () => {
    const suggestions: [string, string, string] = ["One.", "Two.", "Three."];

    expect(suggestionsOutcome({ ok: true, value: { suggestions } })).toEqual({
      state: { type: "shown", suggestions },
      turnLost: false,
    });
  });

  it.each<[string, ApiFailure, string, boolean]>([
    [
      "the hourly limit",
      { type: "rejected", status: 429, code: "ai_rate_limited" },
      "used your suggestions for this hour",
      false,
    ],
    [
      "the AI being down",
      { type: "rejected", status: 503, code: "ai_unavailable" },
      "aren't available right now",
      false,
    ],
    [
      "a lost turn",
      { type: "rejected", status: 403, code: "not_your_turn" },
      "It's no longer your turn.",
      true,
    ],
    ["a network failure", { type: "network" }, "Can't reach the server", false],
  ])("fails with a message for %s", (_name, failure, text, turnLost) => {
    const outcome = suggestionsOutcome({ ok: false, failure });

    expect(outcome.state.type).toBe("failed");
    expect(outcome.state.type === "failed" && outcome.state.message).toContain(text);
    expect(outcome.turnLost).toBe(turnLost);
  });
});
