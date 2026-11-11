// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setClientOutdated } from "../client/clientOutdated";
import { inTheme, renderPage } from "./testRender";
import { UpdateReady } from "./UpdateReady";

const appUpdate = vi.hoisted(() => ({
  updateReady: false,
  applyUpdate: vi.fn<() => Promise<void>>(),
}));
vi.mock("../client/appUpdate", () => ({ useAppUpdate: () => appUpdate }));

afterEach(() => {
  appUpdate.updateReady = false;
  appUpdate.applyUpdate.mockReset();
  setClientOutdated(false);
});

describe("UpdateReady", () => {
  // Pins the bar's life: an empty status region from the start, a notice and an Update button
  // inside that same region once a newer version waits, and the bar stepping aside for the
  // update screen. Without it a screen reader could miss the notice, or two update buttons
  // could show at once.
  it("announces a waiting version in its status region, applies it, and steps aside when the client is outdated", async () => {
    const { rerender } = renderPage(<UpdateReady />);
    const user = userEvent.setup();
    const status = screen.getByRole("status");

    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    appUpdate.updateReady = true;
    rerender(inTheme(<UpdateReady />));

    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("A new version is ready.");
    expect(status).toContainElement(screen.getByRole("button", { name: "Update" }));

    await user.click(screen.getByRole("button", { name: "Update" }));

    expect(appUpdate.applyUpdate).toHaveBeenCalledTimes(1);

    act(() => {
      setClientOutdated(true);
    });

    expect(status).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
