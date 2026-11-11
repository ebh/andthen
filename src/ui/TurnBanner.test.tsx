// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ME, OTHER, THIRD, storyView } from "../client/testFixtures";
import type { StoryView } from "../shared/api";
import { renderPage } from "./testRender";
import { TurnBanner } from "./TurnBanner";

function renderBanner(view: StoryView) {
  renderPage(
    <TurnBanner view={view} now={Date.now()} skipping={false} onSkip={vi.fn<() => void>()} />,
  );
}

describe("TurnBanner", () => {
  it("names the holder, the time left and the turn order, and offers a skip", () => {
    renderBanner(
      storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("It's Sam's turn");
    // The exact wording is describeTimeLeft's. `endsAt` and `now` come from separate Date.now() calls, so the minutes can read 59 or 0 on a slow run.
    expect(screen.getByText(/m left$/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Turn order" })).toHaveTextContent("Me (you)");
    expect(screen.getByRole("button", { name: "Skip Sam" })).toBeEnabled();
  });
});
