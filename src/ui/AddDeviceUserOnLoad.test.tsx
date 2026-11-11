// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addDeviceUserToAccount } from "../client/account";
import { AddDeviceUserOnLoad } from "./AddDeviceUserOnLoad";
import { clerk, resetClerk } from "./clerkStub";

vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);
vi.mock("../client/account", () => ({ addDeviceUserToAccount: vi.fn<() => Promise<void>>() }));

beforeEach(() => {
  resetClerk();
  vi.mocked(addDeviceUserToAccount).mockReset().mockResolvedValue(undefined);
});

describe("AddDeviceUserOnLoad", () => {
  // Pins when the merge runs: not while Clerk is loading, not while signed out, and once when a
  // session exists. Without it a signed-out visitor would trigger a merge call, or a signed-in
  // one would never have an interrupted merge healed.
  it("adds the device user to the account once Clerk has loaded and a session exists", () => {
    clerk.isLoaded = false;
    clerk.isSignedIn = true;
    const { rerender } = render(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).not.toHaveBeenCalled();

    clerk.isLoaded = true;
    clerk.isSignedIn = false;
    rerender(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).not.toHaveBeenCalled();

    clerk.isSignedIn = true;
    rerender(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).toHaveBeenCalledOnce();

    rerender(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).toHaveBeenCalledOnce();
  });
});
