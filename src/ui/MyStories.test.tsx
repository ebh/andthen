// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StorySummary } from "../shared/api";
import { MyStories } from "./MyStories";
import { fakeBlocks, inTheme, renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

function summary(id: string, opening: string, openingAuthorId?: string): StorySummary {
  return {
    id,
    opening,
    ...(openingAuthorId === undefined ? {} : { openingAuthorId }),
    holderName: null,
    isMyTurn: false,
    endsAt: null,
    writerCount: 1,
  };
}

const stories = [
  summary("aaaaa", "Ben opened this one.", "u2"),
  summary("bbbbb", "Cat opened this one.", "u3"),
];

function element() {
  return (
    <MyStories
      stories={stories}
      hasMore={false}
      moreStatus="idle"
      onShowMore={vi.fn<() => void>()}
    />
  );
}

describe("MyStories", () => {
  it("shows the opening of a blocked author as a stand-in that cannot be pressed, and keeps its text out of the page", () => {
    renderPage(element(), fakeBlocks({ blocked: [{ id: "b1", blockedUserId: "u2" }] }));

    const [blocked, other] = screen.getAllByRole("listitem");
    expect(
      within(blocked ?? document.body).getByRole("img", {
        name: "Opening passage, hidden because you blocked its author",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ben opened this one.")).not.toBeInTheDocument();
    expect(within(other ?? document.body).getByText("Cat opened this one.")).toBeInTheDocument();
  });

  it("obscures an opening whose author is unknown, because an older Worker sent none", () => {
    renderPage(
      <MyStories
        stories={[summary("ccccc", "Nobody knows who opened this.")]}
        hasMore={false}
        moreStatus="idle"
        onShowMore={vi.fn<() => void>()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Opening passage, hidden because you blocked its author" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nobody knows who opened this.")).not.toBeInTheDocument();
  });

  it("obscures every opening until the blocks have loaded, then shows the ones not blocked", () => {
    const { rerender } = renderPage(element(), fakeBlocks({ status: "loading" }));

    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByText("Cat opened this one.")).not.toBeInTheDocument();

    rerender(inTheme(element(), fakeBlocks()));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Cat opened this one.")).toBeInTheDocument();
  });
});
