// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncAccount } from "../client/account";
import { AccountSync } from "./AccountSync";
import { clerk, resetClerk } from "./clerkStub";

vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);
vi.mock("../client/account", () => ({ syncAccount: vi.fn<() => Promise<void>>() }));

beforeEach(() => {
  resetClerk();
  vi.mocked(syncAccount).mockReset().mockResolvedValue(undefined);
});

describe("AccountSync", () => {
  it("syncs the account on load while signed in", () => {
    clerk.isSignedIn = true;

    render(<AccountSync />);

    expect(syncAccount).toHaveBeenCalledOnce();
  });

  it("does nothing while signed out", () => {
    render(<AccountSync />);

    expect(syncAccount).not.toHaveBeenCalled();
  });

  it("waits for Clerk to load", () => {
    clerk.isLoaded = false;
    clerk.isSignedIn = true;

    render(<AccountSync />);

    expect(syncAccount).not.toHaveBeenCalled();
  });

  it("syncs when someone signs in", () => {
    const { rerender } = render(<AccountSync />);

    clerk.isSignedIn = true;
    rerender(<AccountSync />);

    expect(syncAccount).toHaveBeenCalledOnce();
  });
});
