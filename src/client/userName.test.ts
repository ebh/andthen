import { describe, expect, it } from "vitest";

import { MAX_DISPLAY_NAME_LENGTH } from "../shared/validation";
import { nameIsSettled, nameStep, nameToSend, nameWasStale, type UserNameLoad } from "./userName";

const loading: UserNameLoad = { type: "loading" };
const failed: UserNameLoad = { type: "failed", failure: { type: "network" } };
const unnamed: UserNameLoad = { type: "loaded", displayName: null };
const named: UserNameLoad = { type: "loaded", displayName: "Ana" };

describe("nameStep", () => {
  it.each([
    ["loading", loading, "loading"],
    ["failed", failed, "failed"],
    ["a user with no name", unnamed, "ask"],
    ["a user with a name", named, "known"],
  ] as const)("reads %s as %s", (_case, load, step) => {
    expect(nameStep(load)).toBe(step);
  });
});

describe("nameIsSettled", () => {
  it.each([
    [loading, false],
    [failed, false],
    [unnamed, true],
    [named, true],
  ] as const)("is %j -> %s", (load, settled) => {
    expect(nameIsSettled(load)).toBe(settled);
  });
});

describe("nameToSend", () => {
  it("sends the trimmed name when the user has none", () => {
    expect(nameToSend(unnamed, "  Sam ")).toEqual({ ok: true, request: { displayName: "Sam" } });
  });

  it("sends no name when the user already has one, whatever was typed", () => {
    expect(nameToSend(named, "Sam")).toEqual({ ok: true, request: {} });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["x".repeat(MAX_DISPLAY_NAME_LENGTH + 1), "too_long"],
  ] as const)("refuses %j for a user with no name (%s)", (typed, problem) => {
    expect(nameToSend(unnamed, typed)).toEqual({ ok: false, problem });
  });
});

describe("nameWasStale", () => {
  it.each([
    ["bad_request", { type: "rejected", status: 400, code: "bad_request" }, true],
    ["invalid_display_name", { type: "rejected", status: 400, code: "invalid_display_name" }, true],
    ["name_taken", { type: "rejected", status: 409, code: "name_taken" }, false],
    ["an unknown code", { type: "unknown_code", status: 400, code: "bad_request" }, false],
    ["a network failure", { type: "network" }, false],
  ] as const)("reads %s as stale: %s", (_case, failure, stale) => {
    expect(nameWasStale(failure)).toBe(stale);
  });
});
