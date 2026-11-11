import { describe, expect, it } from "vitest";

import type { ApiFailure } from "./api";
import {
  BLOCKS_LOAD_FAILED,
  blocksNotice,
  describeBlockFailure,
  describeBlockProgress,
  hiddenPassageLabel,
} from "./blockMessages";

describe("hiddenPassageLabel", () => {
  it("names the author and says why, without the text", () => {
    expect(hiddenPassageLabel("Ben")).toBe("Passage by Ben, hidden because you blocked them");
  });
});

describe("blocksNotice", () => {
  it.each([
    {
      title: "announces progress before anything else",
      blocks: { status: "failed", working: "Blocking…", error: "Couldn't block." },
      notice: { progress: "Blocking…", failure: "" },
    },
    {
      title: "reports the last change's failure before a failed load",
      blocks: { status: "failed", working: null, error: "Couldn't block. Try again." },
      notice: { progress: "", failure: "Couldn't block. Try again." },
    },
    {
      title: "reports a failed load",
      blocks: { status: "failed", working: null, error: null },
      notice: { progress: "", failure: BLOCKS_LOAD_FAILED },
    },
    {
      title: "holds an empty row when all is well",
      blocks: { status: "ready", working: null, error: null },
      notice: { progress: "", failure: "" },
    },
    {
      title: "holds an empty row while loading",
      blocks: { status: "loading", working: null, error: null },
      notice: { progress: "", failure: "" },
    },
  ] as const)("$title", ({ blocks, notice }) => {
    expect(blocksNotice(blocks)).toEqual(notice);
  });
});

const rejected = (code: "cannot_block_self" | "not_found"): ApiFailure => ({
  type: "rejected",
  status: 400,
  code,
});

describe("describeBlockProgress", () => {
  it.each([
    ["block", "Blocking…"],
    ["unblock", "Unblocking…"],
  ] as const)("words the %s in progress without a name", (action, line) => {
    expect(describeBlockProgress(action)).toBe(line);
  });
});

describe("describeBlockFailure", () => {
  it.each([
    ["block", "cannot_block_self", "Couldn't block. That's you."],
    ["unblock", "cannot_block_self", "Couldn't unblock. That's you."],
    ["block", "not_found", "Couldn't block. Reload the page."],
    ["unblock", "not_found", "Couldn't unblock. Reload the page."],
  ] as const)("says why a %s rejected with %s failed", (action, code, line) => {
    expect(describeBlockFailure(action, rejected(code))).toBe(line);
  });

  it.each([
    [{ type: "network" }, "Couldn't block. Check your connection."],
    [{ type: "client_outdated" }, "Couldn't block. Reload the page."],
    [{ type: "unreadable", status: 502 }, "Couldn't block. Try again."],
    [{ type: "rejected", status: 500, code: "internal_error" }, "Couldn't block. Try again."],
  ] as const)("words the failure %j briefly", (failure, line) => {
    expect(describeBlockFailure("block", failure)).toBe(line);
  });

  it("keeps every line short enough for one row on a 375px phone, whatever the user is called", () => {
    const failures: ApiFailure[] = [
      { type: "network" },
      { type: "client_outdated" },
      { type: "unreadable", status: 502 },
      rejected("cannot_block_self"),
      rejected("not_found"),
    ];
    const lines = [
      BLOCKS_LOAD_FAILED,
      describeBlockProgress("block"),
      describeBlockProgress("unblock"),
      ...failures.flatMap((failure) => [
        describeBlockFailure("block", failure),
        describeBlockFailure("unblock", failure),
      ]),
    ];

    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(45);
    }
  });
});
