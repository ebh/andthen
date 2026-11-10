// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, noContentResponse } from "../client/testFixtures";
import { Rejoin } from "./Rejoin";
import type { BlocksValue } from "../client/useBlocks";
import { fakeBlocks, renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRejoin(blocks: BlocksValue = fakeBlocks(), openingAuthorId: string | null = "u2") {
  const onRejoined = vi.fn<() => void>();
  renderPage(
    <Rejoin
      storyId="abc12"
      displayName="Ana"
      opening="The bell rang once."
      openingAuthorId={openingAuthorId ?? undefined}
      onRejoined={onRejoined}
    />,
    blocks,
  );

  return onRejoined;
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

describe("Rejoin", () => {
  it("says which story it is, under which name the writer comes back, and where else to go", () => {
    renderRejoin();

    expect(screen.getByRole("heading", { name: "You left this story" })).toBeInTheDocument();
    expect(screen.getByText("“The bell rang once.”")).toBeInTheDocument();
    expect(screen.getByText(/Rejoin as Ana\. You’ll take the last place/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Your stories" })).toHaveAttribute("href", "/");
  });

  it.each([
    [
      "the user blocks the opening's author",
      fakeBlocks({ blocked: [{ id: "b1", blockedUserId: "u2" }] }),
    ],
    ["the user's blocks have not loaded", fakeBlocks({ status: "loading" })],
  ])(
    "keeps the opening out of the page, as a stand-in that cannot be pressed, when %s",
    (_when, blocks) => {
      renderRejoin(blocks);

      expect(screen.queryByText(/The bell rang once/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "Opening passage, hidden because you blocked its author" }),
      ).toBeInTheDocument();
    },
  );

  it("keeps the opening out of the page when its author is unknown, because an older Worker sent none", () => {
    renderRejoin(fakeBlocks(), null);

    expect(screen.queryByText(/The bell rang once/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Opening passage, hidden because you blocked its author" }),
    ).toBeInTheDocument();
  });

  it("rejoins and reports success", async () => {
    const fetchMock = stubFetch(noContentResponse());
    const onRejoined = renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    await waitFor(() => {
      expect(onRejoined).toHaveBeenCalledOnce();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/rejoin",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("treats already_joined as success: another tab got there first", async () => {
    stubFetch(jsonResponse(409, { error: "already_joined" }));
    const onRejoined = renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    await waitFor(() => {
      expect(onRejoined).toHaveBeenCalledOnce();
    });
  });

  it("says a full story is full and stops offering the button", async () => {
    stubFetch(jsonResponse(409, { error: "story_full" }));
    const onRejoined = renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This story is full (50 writers), so you can't rejoin it.",
    );
    expect(screen.getByRole("button", { name: "Rejoin as Ana" })).toBeDisabled();
    expect(onRejoined).not.toHaveBeenCalled();
  });

  it("says the story changed on a stale turn, and lets the writer try again", async () => {
    stubFetch(jsonResponse(409, { error: "stale_turn" }));
    renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The story just changed.");
    expect(screen.getByRole("button", { name: "Rejoin as Ana" })).toBeEnabled();
  });

  it("shows Rejoining… and disables the button while the request is out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
    );
    renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    expect(await screen.findByRole("button", { name: "Rejoining…" })).toBeDisabled();
  });
});
