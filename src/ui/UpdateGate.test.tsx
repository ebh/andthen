// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setClientOutdated } from "../client/clientOutdated";
import { UpdateGate } from "./UpdateGate";
import { renderPage } from "./testRender";

const unmounted = vi.hoisted(() => vi.fn<() => void>());

vi.mock("expo-router", async () => ({
  ...(await import("./routerStub")).routerStub,
  Slot: () => {
    // Stands in for a story page, whose live socket closes when the page unmounts.
    useEffect(() => unmounted, []);

    return <p>The routed page</p>;
  },
}));

afterEach(() => {
  setClientOutdated(false);
  unmounted.mockClear();
});

describe("UpdateGate", () => {
  it("shows the routed page while the client is current", () => {
    renderPage(<UpdateGate />);

    expect(screen.getByText("The routed page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Update to continue" })).not.toBeInTheDocument();
  });

  it("replaces the routed page with the update screen once the client is outdated", () => {
    renderPage(<UpdateGate />);

    act(() => {
      setClientOutdated(true);
    });

    expect(screen.getByRole("heading", { name: "Update to continue" })).toBeInTheDocument();
    expect(screen.queryByText("The routed page")).not.toBeInTheDocument();
    expect(unmounted).toHaveBeenCalledTimes(1);
  });
});
