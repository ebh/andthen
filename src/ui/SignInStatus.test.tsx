// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignInStatus } from "./SignInStatus";
import { clerk, resetClerk } from "./clerkStub";
import { renderPage } from "./testRender";

const alerts = vi.hoisted(() => ({ turnOff: vi.fn<() => Promise<void>>() }));

vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);
vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);
vi.mock("../client/turnAlerts", () => ({
  useTurnAlerts: () => ({
    state: { type: "unavailable" },
    turnOn: vi.fn<() => void>(),
    turnOff: alerts.turnOff,
  }),
}));

beforeEach(() => {
  resetClerk();
  alerts.turnOff.mockReset().mockResolvedValue(undefined);
});

function signedIn() {
  clerk.isSignedIn = true;
  clerk.userId = "user_1";
  clerk.email = "ana@example.com";
}

describe("SignInStatus signed out", () => {
  it("offers a sign-in link to /sign-in with a line that says why", () => {
    renderPage(<SignInStatus onSignedOut={vi.fn<() => void>()} />);

    expect(screen.getByText("Use your stories on all your devices")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("shows nothing until Clerk has loaded", () => {
    clerk.isLoaded = false;

    renderPage(<SignInStatus onSignedOut={vi.fn<() => void>()} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("SignInStatus signed in", () => {
  it("shows the account's email and a sign-out button, and no sign-in link", () => {
    signedIn();

    renderPage(<SignInStatus onSignedOut={vi.fn<() => void>()} />);

    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("turns alerts off, then signs out, then tells the page", async () => {
    signedIn();
    const order: string[] = [];
    alerts.turnOff.mockImplementation(() => {
      order.push("alerts off");

      return Promise.resolve();
    });
    vi.mocked(clerk.signOut).mockImplementation(() => {
      order.push("sign out");

      return Promise.resolve();
    });
    const onSignedOut = vi.fn<() => void>(() => {
      order.push("page told");
    });
    renderPage(<SignInStatus onSignedOut={onSignedOut} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(order).toEqual(["alerts off", "sign out", "page told"]);
    });
  });

  it("does not sign out until the alerts are off", async () => {
    signedIn();
    const off = Promise.withResolvers<undefined>();
    alerts.turnOff.mockReturnValue(off.promise);
    renderPage(<SignInStatus onSignedOut={vi.fn<() => void>()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));

    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    expect(clerk.signOut).not.toHaveBeenCalled();

    off.resolve(undefined);

    await waitFor(() => {
      expect(clerk.signOut).toHaveBeenCalledOnce();
    });
  });

  it("says so and stays signed in when Clerk fails to sign out", async () => {
    signedIn();
    vi.mocked(clerk.signOut).mockRejectedValue(new Error("offline"));
    const onSignedOut = vi.fn<() => void>();
    renderPage(<SignInStatus onSignedOut={onSignedOut} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign out. Try again.");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
