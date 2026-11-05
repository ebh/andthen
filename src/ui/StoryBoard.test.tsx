// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ME, OTHER, storyView } from "../client/testFixtures";
import { StoryBoard } from "./StoryBoard";
import { renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

const withCompany = storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME });
const alone = storyView({ participants: [ME], holderId: null, lastWriterId: ME });

function renderBoard(view = withCompany, refreshFailed = false, refetch = vi.fn<() => void>()) {
  renderPage(
    <StoryBoard storyId="abc12" view={view} refreshFailed={refreshFailed} refetch={refetch} />,
  );

  return refetch;
}

describe("StoryBoard", () => {
  it("has the wordmark as its level-1 heading and links back to the writer's stories", () => {
    renderBoard();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("link", { name: /Your stories/ })).toHaveAttribute("href", "/");
  });

  it("offers the story's address as the invite link", () => {
    renderBoard();

    expect(screen.getByLabelText("Invite link")).toHaveValue(`${window.location.origin}/abc12`);
  });

  it("tells a lone writer to send the link", () => {
    renderBoard(alone);

    expect(screen.getByText(/Nobody else has joined yet/)).toBeInTheDocument();
  });

  it("says nothing about waiting once someone else has joined", () => {
    renderBoard();

    expect(screen.queryByText(/Nobody else has joined yet/)).not.toBeInTheDocument();
  });

  it("warns that the story may be out of date after a failed reload, and retries on request", async () => {
    const refetch = renderBoard(withCompany, true);

    expect(screen.getByText(/Couldn't refresh the story\./)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows no warning while the story is fresh", () => {
    renderBoard();

    expect(screen.queryByText(/Couldn't refresh/)).not.toBeInTheDocument();
  });
});
