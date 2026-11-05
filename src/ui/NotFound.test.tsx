// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NotFound } from "./NotFound";
import { renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

describe("NotFound", () => {
  it("says there is nothing here, under the wordmark's level-1 heading", () => {
    renderPage(<NotFound />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("heading", { level: 2, name: "Not found" })).toBeInTheDocument();
    expect(screen.getByText("There's nothing at this address.")).toBeInTheDocument();
  });

  it("offers a way back to starting a story", () => {
    renderPage(<NotFound />);

    expect(screen.getByRole("button", { name: "Start a new story" })).toHaveAttribute("href", "/");
  });
});
