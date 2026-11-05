// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Wordmark } from "./Wordmark";
import { renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

describe("Wordmark", () => {
  it("is the page's level-1 heading and a link home", () => {
    renderPage(<Wordmark />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("link", { name: "And then…" })).toHaveAttribute("href", "/");
  });
});
