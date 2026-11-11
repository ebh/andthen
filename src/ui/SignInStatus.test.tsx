// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { onSignedOut as onAccountSignedOut } from "../client/account";
import { SignInStatus } from "./SignInStatus";
import { clerk, resetClerk } from "./clerkStub";
import { inTheme, renderPage } from "./testRender";

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

// NewStory's tests reach the signed-out link and a successful sign-out through the page. What
// only Clerk's own state decides is covered here.
describe("SignInStatus", () => {
  // Pins that nothing shows while Clerk is still loading, since until then the component cannot
  // tell a signed-out visitor from a signed-in one. Without it a signed-in writer would first be
  // offered a sign-in link.
  it("shows nothing until Clerk has loaded, then offers sign-in to someone signed out", () => {
    clerk.isLoaded = false;
    const onSignedOut = vi.fn<() => void>();
    const { rerender } = renderPage(<SignInStatus onSignedOut={onSignedOut} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    clerk.isLoaded = true;
    rerender(inTheme(<SignInStatus onSignedOut={onSignedOut} />));

    expect(screen.getByText("Use your stories on all your devices")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  // Pins the order that keeps a browser from being left subscribed: alerts go off while the
  // session can still authorise the Worker, then Clerk signs out, then the page is told. It also
  // pins that a failed sign-out leaves the writer signed in with a message, and that trying again
  // clears the message. The blocks are told right after Clerk signs out and before the page, so
  // they drop the account's list before anything is fetched as the anonymous user.
  it("turns alerts off, then signs out, then tells the page, and recovers from a failed sign-out", async () => {
    clerk.isSignedIn = true;
    clerk.userId = "user_1";
    const order: string[] = [];
    const alertsOff = Promise.withResolvers<undefined>();
    const secondSignOut = Promise.withResolvers<undefined>();
    alerts.turnOff
      .mockImplementationOnce(() => {
        order.push("alerts off");

        return alertsOff.promise;
      })
      .mockImplementation(() => {
        order.push("alerts off");

        return Promise.resolve();
      });
    vi.mocked(clerk.signOut)
      .mockImplementationOnce(() => {
        order.push("sign out");

        return Promise.reject(new Error("offline"));
      })
      .mockImplementation(() => {
        order.push("sign out");

        return secondSignOut.promise;
      });
    const stopListening = onAccountSignedOut(() => {
      order.push("blocks told");
    });
    const onSignedOut = vi.fn<() => void>(() => {
      order.push("page told");
    });
    const { rerender } = renderPage(<SignInStatus onSignedOut={onSignedOut} />);
    const user = userEvent.setup();

    // Signed in with no email known yet, then with one.
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    clerk.email = "ana@example.com";
    rerender(inTheme(<SignInStatus onSignedOut={onSignedOut} />));
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Signed in")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/^$/);

    // Waiting on the alerts: the button is held and Clerk is not asked yet.
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    expect(clerk.signOut).not.toHaveBeenCalled();

    // Clerk fails: the writer stays signed in, is told, and the page hears nothing.
    alertsOff.resolve(undefined);
    expect(await screen.findByText("Couldn't sign out. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(onSignedOut).not.toHaveBeenCalled();

    // Tried again: the message goes while the request is out, and the page is told only after it.
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("button", { name: "Signing out…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/^$/);
    expect(onSignedOut).not.toHaveBeenCalled();
    secondSignOut.resolve(undefined);
    await waitFor(() => {
      expect(onSignedOut).toHaveBeenCalledOnce();
    });
    expect(order).toEqual([
      "alerts off",
      "sign out",
      "alerts off",
      "sign out",
      "blocks told",
      "page told",
    ]);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    stopListening();
  });
});
