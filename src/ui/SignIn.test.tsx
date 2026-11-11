// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { addDeviceUserToAccount } from "../client/account";
import { clerk, resetClerk } from "./clerkStub";
import { replace, routerStub } from "./routerStub";
import { SignIn } from "./SignIn";
import { inTheme, renderPage } from "./testRender";

const clerkSignIn = vi.hoisted(() => vi.fn<(props: unknown) => void>());

vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);
vi.mock("@clerk/expo/web", () => ({
  SignIn: (props: unknown) => {
    clerkSignIn(props);

    return <div data-testid="clerk-sign-in" />;
  },
}));
vi.mock("expo-router", () => routerStub);
vi.mock("../client/account", () => ({ addDeviceUserToAccount: vi.fn<() => Promise<void>>() }));

// What the page hands Clerk's form: how it routes, and a colour for every role it draws. A
// colour is checked only to be set, because the theme owns its value.
const colour = z.string().min(1);
const clerkProps = z.strictObject({
  routing: z.literal("hash"),
  withSignUp: z.literal(true),
  fallbackRedirectUrl: z.literal("/"),
  appearance: z.strictObject({
    variables: z.strictObject({
      colorBackground: colour,
      colorForeground: colour,
      colorMutedForeground: colour,
      colorNeutral: colour,
      colorPrimary: colour,
      colorPrimaryForeground: colour,
      colorDanger: colour,
      colorBorder: colour,
      colorInput: colour,
      colorInputForeground: colour,
      fontFamily: z.literal("Inter_400Regular, system-ui, sans-serif"),
    }),
  }),
});

beforeEach(() => {
  resetClerk();
  replace.mockClear();
  clerkSignIn.mockClear();
  vi.mocked(addDeviceUserToAccount).mockReset().mockResolvedValue(undefined);
});

describe("SignIn", () => {
  // Pins the page's whole life: Clerk's form, set up with the app's colours and font, while
  // nobody is signed in; then, with a session, the status line, the device's stories added to
  // the account once Clerk has loaded, and only after that the home page. Without it a sign-in
  // could open the home page before the merge, or never leave this page.
  it("hosts Clerk's form until someone signs in, then adds the device's stories and opens the home page", async () => {
    clerk.isLoaded = false;
    const { rerender } = renderPage(<SignIn />);

    // Clerk is still loading: the form shows, set up for sign-in or sign-up.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(() => clerkProps.parse(clerkSignIn.mock.lastCall?.[0])).not.toThrow();
    expect(addDeviceUserToAccount).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    // A session shows before Clerk reports itself loaded: the writer sees the status line, but
    // nothing is merged or opened until Clerk has loaded.
    clerk.isSignedIn = true;
    rerender(inTheme(<SignIn />));

    expect(screen.getByRole("status")).toHaveTextContent("Signing you in…");
    expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
    expect(addDeviceUserToAccount).not.toHaveBeenCalled();

    // Clerk has loaded while the merge is held: it starts once, and the page stays put until it
    // finishes.
    const added = Promise.withResolvers<undefined>();
    vi.mocked(addDeviceUserToAccount).mockReturnValue(added.promise);
    clerk.isLoaded = true;
    rerender(inTheme(<SignIn />));

    expect(addDeviceUserToAccount).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();

    added.resolve(undefined);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/");
    });
    expect(addDeviceUserToAccount).toHaveBeenCalledOnce();
  });
});
