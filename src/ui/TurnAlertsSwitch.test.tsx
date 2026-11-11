// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnAlertsState } from "../client/turnAlerts";
import { renderPage } from "./testRender";
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

function show(state: TurnAlertsState) {
  alerts.state = state;
  renderPage(<TurnAlertsSwitch />);
}

const off: TurnAlertsState = { type: "ready", on: false, busy: false, failed: false };

beforeEach(() => {
  vi.mocked(alerts.turnOn).mockResolvedValue(undefined);
  vi.mocked(alerts.turnOff).mockResolvedValue(undefined);
});

describe("TurnAlertsSwitch", () => {
  it("renders nothing where alerts are not available", () => {
    show({ type: "unavailable" });

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/notif/i)).not.toBeInTheDocument();
  });

  it("offers a switch labelled for the reader's turn, off by default", () => {
    show(off);

    expect(screen.getByRole("switch", { name: "Notify me when it's my turn" })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("turns alerts on when the reader switches it on", async () => {
    show(off);

    await userEvent.setup().click(screen.getByRole("switch"));

    expect(alerts.turnOn).toHaveBeenCalledTimes(1);
    expect(alerts.turnOff).not.toHaveBeenCalled();
  });

  it("shows the switch on, and turns alerts off when the reader switches it off", async () => {
    show({ ...off, on: true });
    const toggle = screen.getByRole("switch", { name: "Notify me when it's my turn" });
    expect(toggle).toBeChecked();

    await userEvent.setup().click(toggle);

    expect(alerts.turnOff).toHaveBeenCalledTimes(1);
    expect(alerts.turnOn).not.toHaveBeenCalled();
  });

  it("asks an iPhone or iPad in a browser tab to add the app to the Home Screen, with no switch", () => {
    show({ type: "needs_install" });

    expect(
      screen.getByText(
        "To get notified, add this app to your Home Screen: tap Share (under ⋯ on newer iPhones), then Add to Home Screen.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("says so in an alert when turning on failed, and leaves the switch off and usable", () => {
    show({ ...off, failed: true });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Notifications couldn't be turned on in this browser.",
    );
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.getByRole("switch")).toBeEnabled();
  });
});
