// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addDeviceUserToAccount } from "../client/account";
import { clerk, resetClerk } from "./clerkStub";
import { replace, routerStub } from "./routerStub";
import { SignIn } from "./SignIn";
import { renderPage } from "./testRender";

vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);
vi.mock("@clerk/expo/web", () => ({
  SignIn: () => <div data-testid="clerk-sign-in" />,
}));
vi.mock("expo-router", () => routerStub);
vi.mock("../client/account", () => ({ addDeviceUserToAccount: vi.fn<() => Promise<void>>() }));

beforeEach(() => {
  resetClerk();
  replace.mockClear();
  vi.mocked(addDeviceUserToAccount).mockReset().mockResolvedValue(undefined);
});

describe("SignIn", () => {
  it("hosts Clerk's sign-in form while nobody is signed in", () => {
    renderPage(<SignIn />);

    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(addDeviceUserToAccount).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("adds the device user to the account and only then opens the home page once signed in", async () => {
    clerk.isSignedIn = true;
    const added = Promise.withResolvers<undefined>();
    vi.mocked(addDeviceUserToAccount).mockReturnValue(added.promise);

    renderPage(<SignIn />);

    expect(screen.getByRole("status")).toHaveTextContent("Signing you in…");
    expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
    expect(addDeviceUserToAccount).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();

    added.resolve(undefined);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/");
    });
  });

  it("does not leave the page before Clerk has loaded", () => {
    clerk.isLoaded = false;
    clerk.isSignedIn = true;

    renderPage(<SignIn />);

    expect(addDeviceUserToAccount).not.toHaveBeenCalled();
  });
});
