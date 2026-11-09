// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppInstallState } from "../client/appInstall";
import { InstallButton } from "./InstallButton";
import { renderPage } from "./testRender";

const appInstall = vi.hoisted((): { state: AppInstallState; install: () => Promise<void> } => ({
  state: { type: "unavailable" },
  install: vi.fn<() => Promise<void>>(),
}));

vi.mock("../client/appInstall", () => ({
  useAppInstall: () => ({ state: appInstall.state, install: appInstall.install }),
}));

function show(state: AppInstallState) {
  appInstall.state = state;
  renderPage(<InstallButton />);
}

beforeEach(() => {
  vi.mocked(appInstall.install).mockResolvedValue(undefined);
});

describe("InstallButton", () => {
  it("renders nothing where the app cannot be installed", () => {
    show({ type: "unavailable" });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers the install, and starts it when pressed", async () => {
    show({ type: "ready", busy: false });

    await userEvent.setup().click(screen.getByRole("button", { name: "Install the app" }));

    expect(appInstall.install).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the browser's install dialog is open", () => {
    show({ type: "ready", busy: true });

    expect(screen.getByRole("button", { name: "Install the app" })).toBeDisabled();
  });
});
