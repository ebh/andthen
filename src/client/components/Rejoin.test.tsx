// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, noContentResponse } from "../testFixtures";
import { Rejoin } from "./Rejoin";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderRejoin() {
  const onRejoined = vi.fn<() => void>();
  render(
    <Rejoin
      storyId="abc12"
      displayName="Ana"
      opening="The bell rang once."
      onRejoined={onRejoined}
    />,
  );

  return onRejoined;
}

describe("Rejoin", () => {
  it("says which story it is, under which name the writer comes back, and where else to go", () => {
    renderRejoin();

    expect(screen.getByRole("heading", { name: "You left this story" })).toBeInTheDocument();
    expect(screen.getByText("“The bell rang once.”")).toBeInTheDocument();
    expect(screen.getByText(/Rejoin as Ana\. You’ll take the last place/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your stories" })).toHaveAttribute("href", "/");
  });

  it("rejoins and reports success", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(noContentResponse()));
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(409, { error: "already_joined" }))),
    );
    const onRejoined = renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    await waitFor(() => {
      expect(onRejoined).toHaveBeenCalledOnce();
    });
  });

  it("says a full story is full and stops offering the button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(409, { error: "story_full" }))),
    );
    const onRejoined = renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This story is full (50 writers)");
    expect(screen.getByRole("button", { name: "Rejoin as Ana" })).toBeDisabled();
    expect(onRejoined).not.toHaveBeenCalled();
  });

  it("says the story changed on a stale turn, and lets the writer try again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(409, { error: "stale_turn" }))),
    );
    renderRejoin();

    await userEvent.setup().click(screen.getByRole("button", { name: "Rejoin as Ana" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The story just changed.");
    expect(screen.getByRole("button", { name: "Rejoin as Ana" })).toBeEnabled();
  });
});
