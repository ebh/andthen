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
  it("adds the device user to the account on load while signed in", () => {
    clerk.isSignedIn = true;

    render(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).toHaveBeenCalledOnce();
  });

  it("does nothing while signed out", () => {
    render(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).not.toHaveBeenCalled();
  });

  it("waits for Clerk to load", () => {
    clerk.isLoaded = false;
    clerk.isSignedIn = true;

    render(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).not.toHaveBeenCalled();
  });

  it("adds the device user when someone signs in", () => {
    const { rerender } = render(<AddDeviceUserOnLoad />);

    clerk.isSignedIn = true;
    rerender(<AddDeviceUserOnLoad />);

    expect(addDeviceUserToAccount).toHaveBeenCalledOnce();
  });
});
