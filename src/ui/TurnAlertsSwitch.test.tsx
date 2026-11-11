// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnAlertsState } from "../client/turnAlerts";
import { inTheme, renderPage } from "./testRender";
import { TurnAlertsSwitch } from "./TurnAlertsSwitch";

interface FakeAlerts {
  state: TurnAlertsState;
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
}

const alerts = vi.hoisted((): FakeAlerts => ({
  state: { type: "unavailable" },
  turnOn: vi.fn<() => Promise<void>>(),
  turnOff: vi.fn<() => Promise<void>>(),
}));

vi.mock("../client/turnAlerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/turnAlerts")>()),
  useTurnAlerts: () => ({ state: alerts.state, turnOn: alerts.turnOn, turnOff: alerts.turnOff }),
}));

const off: TurnAlertsState = { type: "ready", on: false, busy: false, failed: false };
const SWITCH = { name: "Notify me when it's my turn" };

// The hook is the browser's push state; a test moves it on and renders again, as a state change would.
function renderAlerts(state: TurnAlertsState) {
  alerts.state = state;
  const { rerender } = renderPage(<TurnAlertsSwitch />);

  return (next: TurnAlertsState) => {
    alerts.state = next;
    rerender(inTheme(<TurnAlertsSwitch />));
  };
}

beforeEach(() => {
  vi.mocked(alerts.turnOn).mockResolvedValue(undefined);
  vi.mocked(alerts.turnOff).mockResolvedValue(undefined);
});

describe("TurnAlertsSwitch", () => {
  it("offers no switch where alerts are unavailable, asks an iPhone in a tab to install, and explains a block", () => {
    const show = renderAlerts({ type: "unavailable" });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/notif/i)).not.toBeInTheDocument();

    show({ type: "needs_install" });
    expect(
      screen.getByText(
        "To get notified, add this app to your Home Screen: tap Share (under ⋯ on newer iPhones), then Add to Home Screen.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    show({ type: "blocked" });
    expect(screen.getByRole("switch", SWITCH)).toBeDisabled();
    expect(screen.getByRole("switch", SWITCH)).not.toBeChecked();
    expect(screen.getByText(/blocked in this browser's settings/)).toBeInTheDocument();
    expect(screen.queryByText(/Home Screen/)).not.toBeInTheDocument();
  });

  it("turns alerts on and off, and locks the switch while the browser works", async () => {
    const user = userEvent.setup();
    const show = renderAlerts(off);
    expect(screen.getByRole("switch", SWITCH)).not.toBeChecked();
    expect(screen.getByRole("switch", SWITCH)).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/blocked/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", SWITCH));
    expect(alerts.turnOn).toHaveBeenCalledTimes(1);
    expect(alerts.turnOff).not.toHaveBeenCalled();

    show({ ...off, busy: true });
    expect(screen.getByRole("switch", SWITCH)).toBeDisabled();
    await user.click(screen.getByRole("switch", SWITCH));
    expect(alerts.turnOn).toHaveBeenCalledTimes(1);

    show({ ...off, on: true });
    expect(screen.getByRole("switch", SWITCH)).toBeChecked();
    expect(screen.getByRole("switch", SWITCH)).toBeEnabled();

    await user.click(screen.getByRole("switch", SWITCH));
    expect(alerts.turnOff).toHaveBeenCalledTimes(1);
    expect(alerts.turnOn).toHaveBeenCalledTimes(1);

    show({ ...off, on: true, busy: true });
    expect(screen.getByRole("switch", SWITCH)).toBeDisabled();
  });

  it("says in an alert when turning on or off failed, and leaves the switch usable", () => {
    const show = renderAlerts({ ...off, failed: true });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Notifications couldn't be turned on in this browser.",
    );
    expect(screen.getByRole("switch", SWITCH)).not.toBeChecked();
    expect(screen.getByRole("switch", SWITCH)).toBeEnabled();

    show({ ...off, on: true, failed: true });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Notifications couldn't be turned off in this browser.",
    );
    expect(screen.getByRole("switch", SWITCH)).toBeChecked();
    expect(screen.getByRole("switch", SWITCH)).toBeEnabled();

    show({ ...off, on: true });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
