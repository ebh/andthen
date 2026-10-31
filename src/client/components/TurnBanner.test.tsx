// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StoryView } from "../../shared/api";
import { ME, OTHER, THIRD, storyView } from "../testFixtures";
import { TurnBanner } from "./TurnBanner";

function renderBanner(view: StoryView) {
  render(<TurnBanner view={view} now={Date.now()} skipping={false} onSkip={vi.fn<() => void>()} />);
}

describe("TurnBanner", () => {
  it("tells the holder it is their turn, with no skip button", () => {
    renderBanner(
      storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("It's your turn");
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
  });

  it("names the holder, the time left and the rotation, and offers a skip", () => {
    renderBanner(
      storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("It's Sam's turn");
    expect(screen.getByText("1h 0m left")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Turn order" })).toHaveTextContent("Me (you)");
    expect(screen.getByRole("button", { name: "Skip Sam" })).toBeEnabled();
  });

  it("hides skip in a two-person story, where the server would refuse it", () => {
    renderBanner(storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME }));

    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
  });

  it("says the story is waiting when nobody holds the turn", () => {
    renderBanner(storyView({ participants: [ME], holderId: null, lastWriterId: ME }));

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for someone to join");
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
  });
});
