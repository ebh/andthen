// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setClientOutdated } from "../client/clientOutdated";
import { renderPage } from "./testRender";
import { UpdateGate } from "./UpdateGate";

const unmounted = vi.hoisted(() => vi.fn<() => void>());
const applyUpdate = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("expo-router", async () => ({
  ...(await import("./routerStub")).routerStub,
  Slot: () => {
    // Stands in for a story page, whose live socket closes when the page unmounts.
    useEffect(() => unmounted, []);

    return <p>The routed page</p>;
  },
}));
vi.mock("../client/appUpdate", () => ({
  useAppUpdate: () => ({ updateReady: false, applyUpdate }),
}));

afterEach(() => {
  setClientOutdated(false);
  unmounted.mockClear();
  applyUpdate.mockReset();
});

describe("UpdateGate", () => {
  // Pins the swap: the routed page shows while the client is current, and the update screen
  // replaces it, unmounting it, once the Worker has refused this build. Without it a retired
  // build would keep its live socket open and retry against a Worker that refuses it.
  it("shows the routed page, then replaces it with the update screen once the client is outdated", async () => {
    renderPage(<UpdateGate />);
    const user = userEvent.setup();

    expect(screen.getByText("The routed page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Update to continue" })).not.toBeInTheDocument();

    act(() => {
      setClientOutdated(true);
    });

    expect(screen.queryByText("The routed page")).not.toBeInTheDocument();
    expect(unmounted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("heading", { level: 2, name: "Update to continue" })).toBeVisible();
    expect(screen.getByText("This version of And then… is out of date.")).toBeVisible();
    expect(screen.queryByRole("link", { name: /stor/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Update now" }));

    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });
});
