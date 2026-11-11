// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppInstallState } from "../client/appInstall";
import { InstallButton } from "./InstallButton";
import { inTheme, renderPage } from "./testRender";

const appInstall = vi.hoisted((): { state: AppInstallState; install: () => Promise<void> } => ({
  state: { type: "unavailable" },
  install: vi.fn<() => Promise<void>>(),
}));

vi.mock("../client/appInstall", () => ({
  useAppInstall: () => ({ state: appInstall.state, install: appInstall.install }),
}));

beforeEach(() => {
  vi.mocked(appInstall.install).mockResolvedValue(undefined);
});

describe("InstallButton", () => {
  it("appears once the browser offers the install, starts it on press and waits while its dialog is open", async () => {
    appInstall.state = { type: "unavailable" };
    const { rerender } = renderPage(<InstallButton />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    appInstall.state = { type: "ready", busy: false };
    rerender(inTheme(<InstallButton />));
    await userEvent.setup().click(screen.getByRole("button", { name: "Install the app" }));
    expect(appInstall.install).toHaveBeenCalledTimes(1);

    appInstall.state = { type: "ready", busy: true };
    rerender(inTheme(<InstallButton />));
    expect(screen.getByRole("button", { name: "Install the app" })).toBeDisabled();
  });
});
