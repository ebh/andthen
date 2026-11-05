// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setClientOutdated } from "../client/clientOutdated";
import { renderPage } from "./testRender";
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
  it("shows nothing while no newer version is waiting, but keeps the status region in place", () => {
    renderPage(<UpdateReady />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says a new version is ready, inside the status region, with an Update button", () => {
    appUpdate.updateReady = true;
    renderPage(<UpdateReady />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("A new version is ready.");
    expect(status).toContainElement(screen.getByRole("button", { name: "Update" }));
  });

  it("applies the update when Update is pressed", () => {
    appUpdate.updateReady = true;
    renderPage(<UpdateReady />);

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(appUpdate.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("steps aside for the update screen once the client is outdated", () => {
    appUpdate.updateReady = true;
    renderPage(<UpdateReady />);

    act(() => {
      setClientOutdated(true);
    });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("A new version is ready.")).not.toBeInTheDocument();
  });
});
