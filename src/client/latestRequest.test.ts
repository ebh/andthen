import { describe, expect, it } from "vitest";

import { createLatestRequest } from "./latestRequest";

describe("createLatestRequest", () => {
  it("makes a started request current", () => {
    const latest = createLatestRequest();

    const isCurrent = latest.start();

    expect(isCurrent()).toBe(true);
  });

  it("lets a later start overtake an earlier one", () => {
    const latest = createLatestRequest();
    const first = latest.start();

    latest.start();

    expect(first()).toBe(false);
  });

  it("keeps a joined request current until the next start", () => {
    const latest = createLatestRequest();
    latest.start();
    const joined = latest.join();

    expect(joined()).toBe(true);
  });

  it("overtakes a joined request with a later start", () => {
    const latest = createLatestRequest();
    const joined = latest.join();

    latest.start();

    expect(joined()).toBe(false);
  });

  it("leaves the earlier start current when a request joins", () => {
    const latest = createLatestRequest();
    const first = latest.start();

    latest.join();

    expect(first()).toBe(true);
  });

  it.each([
    ["a start", (latest: ReturnType<typeof createLatestRequest>) => latest.start()],
    ["a join", (latest: ReturnType<typeof createLatestRequest>) => latest.join()],
  ])("makes %s stop being current on cancel", (_name, begin) => {
    const latest = createLatestRequest();
    const isCurrent = begin(latest);

    latest.cancel();

    expect(isCurrent()).toBe(false);
  });

  it("makes a start after a cancel current", () => {
    const latest = createLatestRequest();
    latest.cancel();

    const isCurrent = latest.start();

    expect(isCurrent()).toBe(true);
  });
});
