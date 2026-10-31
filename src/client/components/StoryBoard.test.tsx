// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ME, OTHER, THIRD, jsonResponse, noContentResponse, storyView } from "../testFixtures";
import { StoryBoard } from "./StoryBoard";

// The hook opens a real WebSocket; its logic is covered in live.test.ts.
vi.mock("../useStoryLive", () => ({ useStoryLive: vi.fn<() => void>() }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const myTurn = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER });

function renderBoard(view = myTurn, refetch = vi.fn<() => void>()) {
  render(<StoryBoard storyId="abc12" view={view} refreshFailed={false} refetch={refetch} />);

  return refetch;
}

describe("composer", () => {
  it("counts graphemes live and disables send when empty or over the limit", async () => {
    renderBoard();
    const user = userEvent.setup();
    const field = screen.getByLabelText("Your passage");
    const send = screen.getByRole("button", { name: "Add to the story" });
    expect(send).toBeDisabled();

    await user.type(field, "Hi 👨‍👩‍👧");
    expect(screen.getByText("4 / 280")).toBeInTheDocument();
    expect(send).toBeEnabled();

    await user.clear(field);
    await user.click(field);
    await user.paste("x".repeat(281));
    expect(screen.getByText(/281 \/ 280/)).toHaveTextContent("too long");
    expect(send).toBeDisabled();
  });

  it("is absent when it is not your turn", () => {
    renderBoard(storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME }));

    expect(screen.queryByLabelText("Your passage")).not.toBeInTheDocument();
  });

  it("sends the passage with the shown turn version and clears it on success", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(noContentResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const refetch = renderBoard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "And then.");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Your passage")).toHaveValue("");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/contributions",
      expect.objectContaining({ body: JSON.stringify({ text: "And then.", turnVersion: 3 }) }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the text and refetches on a 409 stale_turn", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "stale_turn" })));
    const refetch = renderBoard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "Precious words");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    expect(await screen.findByText(/The story changed while you were writing/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your passage")).toHaveValue("Precious words");
    expect(refetch).toHaveBeenCalled();
  });

  it("explains a 403 not_your_turn differently, keeps the text and refetches", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(403, { error: "not_your_turn" })));
    const refetch = renderBoard();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "Late words");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    expect(await screen.findByText(/no longer your turn/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your passage")).toHaveValue("Late words");
    expect(refetch).toHaveBeenCalled();
  });
});

describe("suggestions in the composer", () => {
  it("puts the chosen suggestion in the composer for editing and does not submit", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(200, { suggestions: ["One.", "Two.", "Three."] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderBoard();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Suggest continuations" }));
    await user.click(await screen.findByRole("button", { name: "Three." }));

    expect(screen.getByLabelText("Your passage")).toHaveValue("Three.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("is not offered to someone who does not hold the turn", () => {
    renderBoard(storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME }));

    expect(screen.queryByRole("button", { name: "Suggest continuations" })).not.toBeInTheDocument();
  });
});

describe("skip", () => {
  const skippable = storyView({
    participants: [ME, OTHER, THIRD],
    holderId: OTHER,
    lastWriterId: THIRD,
    version: 5,
  });

  it("sends the shown turn version and refetches", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(noContentResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const refetch = renderBoard(skippable);

    await userEvent.setup().click(screen.getByRole("button", { name: "Skip Sam" }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/skip",
      expect.objectContaining({ body: JSON.stringify({ turnVersion: 5 }) }),
    );
  });

  it("refetches and says nothing was skipped on a 409 stale_turn", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "stale_turn" })));
    const refetch = renderBoard(skippable);

    await userEvent.setup().click(screen.getByRole("button", { name: "Skip Sam" }));

    expect(await screen.findByText(/nothing was skipped/)).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();
  });
});

describe("waiting for a joiner", () => {
  it("shows a message and the invite link", () => {
    renderBoard(storyView({ participants: [ME], holderId: null, lastWriterId: ME }));

    expect(screen.getByText(/Nobody else has joined yet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Invite link")).toHaveValue(`${window.location.origin}/abc12`);
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});
