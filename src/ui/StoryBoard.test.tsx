// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { takeLeftStoryNote } from "../client/leftStoryNote";
import {
  ME,
  OTHER,
  THIRD,
  jsonResponse,
  noContentResponse,
  storyView,
} from "../client/testFixtures";
import { useStoryLive } from "../client/useStoryLive";
import { replace } from "./routerStub";
import { StoryBoard } from "./StoryBoard";
import { inTheme, renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

// The hook opens a real WebSocket; its logic is covered in live.test.ts and useStoryLive.test.tsx.
vi.mock("../client/useStoryLive", () => ({ useStoryLive: vi.fn<() => void>() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const alone = storyView({ participants: [ME], holderId: null, lastWriterId: ME });
const someoneElsesTurn = storyView({
  participants: [ME, OTHER, THIRD],
  holderId: OTHER,
  lastWriterId: THIRD,
  version: 5,
});
const myTurn = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER });

describe("StoryBoard", () => {
  it("shows a lone writer the invite link and no composer", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>());
    renderBoard(alone);
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("link", { name: /Your stories/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "support@andthen.page" })).toHaveAttribute(
      "href",
      "mailto:support@andthen.page",
    );
    expect(
      within(screen.getByRole("region", { name: "Turn" })).getByRole("status"),
    ).toHaveTextContent("Waiting for someone to join");
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nobody else has joined yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your passage")).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't refresh/)).not.toBeInTheDocument();

    const invite = `${window.location.origin}/abc12`;
    const field = screen.getByLabelText("Invite link");
    expect(field).toHaveValue(invite);
    expect(field).toHaveAttribute("readonly");

    expect(screen.queryByText("Link copied.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't copy/)).not.toBeInTheDocument();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValueOnce();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(invite);

    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText(/Couldn't copy/)).toBeInTheDocument();
    expect(screen.queryByText("Link copied.")).not.toBeInTheDocument();
  });

  it("shows someone else's turn, offers no writing, and retries a failed reload", async () => {
    const refetch = renderBoard(someoneElsesTurn, true);
    const user = userEvent.setup();

    expect(screen.getByRole("region", { name: "Turn" })).toHaveTextContent("It's Sam's turn");
    // The wording is describeTimeLeft's. `endsAt` and `now` come from separate clocks, so the minutes can vary.
    expect(screen.getByText(/m left$/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Turn order" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Me (you)", "Sam", "Kim"]);
    expect(useStoryLive).toHaveBeenCalledWith({
      storyId: "abc12",
      endsAt: someoneElsesTurn.turn.endsAt,
      refetch,
    });
    expect(screen.queryByText(/Nobody else has joined yet/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your passage")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suggest continuations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "New paragraph" })).not.toBeInTheDocument();

    expect(screen.getByText(/Couldn't refresh the story\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();

    const { dialog } = await openDialog(user);
    expect(dialog).toHaveTextContent(
      /Your passages stay in the story under your name\. You’ll drop out of the turn order\. You can rejoin from the invite link\./,
    );
    expect(dialog).not.toHaveTextContent("your turn now");
  });

  it("walks a writer through a turn: suggestions, a stale turn, a rejected passage, then sending", async () => {
    const hostile = '<img src=x onerror="alert(1)"> <b>bold</b>';
    const suggestionsRequest = inFlight();
    const staleSend = inFlight();
    const rejectedSend = inFlight();
    const goodSend = inFlight();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(suggestionsRequest.response)
      .mockReturnValueOnce(staleSend.response)
      .mockReturnValueOnce(rejectedSend.response)
      .mockReturnValueOnce(goodSend.response)
      .mockResolvedValueOnce(jsonResponse(403, { error: "not_your_turn" }));
    vi.stubGlobal("fetch", fetchMock);
    const refetch = vi.fn<() => void>();
    const { container, rerender } = renderPage(
      <StrictMode>
        <StoryBoard storyId="abc12" view={myTurn} refreshFailed={false} refetch={refetch} />
      </StrictMode>,
    );
    const user = userEvent.setup();
    const field = screen.getByLabelText("Your passage");
    const send = screen.getByRole("button", { name: "Add to the story" });
    const newParagraph = screen.getByRole("checkbox", { name: "New paragraph" });
    expect(send).toBeDisabled();

    // Counting is validation.test.ts's; this checks the screen shows one count and the over-limit state.
    await user.type(field, "Hi 👨‍👩‍👧");
    expect(screen.getByText("4 / 280")).toBeInTheDocument();
    expect(send).toBeEnabled();
    await user.clear(field);
    await user.click(field);
    await user.paste("x".repeat(280));
    expect(screen.getByText("280 / 280")).toBeInTheDocument();
    expect(send).toBeEnabled();
    await user.type(field, "x");
    expect(screen.getByText(/281 \/ 280/)).toHaveTextContent("too long");
    expect(send).toBeDisabled();
    await user.clear(field);
    await user.type(field, "My own words");

    await user.click(screen.getByRole("button", { name: "Suggest continuations" }));
    expect(screen.getByRole("button", { name: "Thinking…" })).toBeDisabled();
    suggestionsRequest.finish(jsonResponse(200, { suggestions: [hostile, "Two.", "Three."] }));
    expect(await screen.findByRole("button", { name: hostile })).toBeInTheDocument();
    expect(container.querySelector("img, b")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Two." }));
    expect(field).toHaveValue("Two.");
    expect(field).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(field).toHaveValue("My own words");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();

    await user.click(newParagraph);
    expect(newParagraph).toBeChecked();
    await user.click(newParagraph);
    expect(newParagraph).not.toBeChecked();
    await user.click(newParagraph);
    await user.click(send);
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    staleSend.finish(jsonResponse(409, { error: "stale_turn" }));
    expect(await screen.findByText(/The story changed while you were writing/)).toBeInTheDocument();
    expect(field).toHaveValue("My own words");
    expect(newParagraph).toBeChecked();
    expect(refetch).toHaveBeenCalledOnce();

    await user.click(send);
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.queryByText(/The story changed while you were writing/)).not.toBeInTheDocument();
    rejectedSend.finish(jsonResponse(400, { error: "invalid_passage" }));
    expect(await screen.findByText(/That passage can't be sent/)).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledOnce();

    const newer = storyView({
      participants: [ME, OTHER, THIRD],
      holderId: ME,
      lastWriterId: OTHER,
      version: 4,
    });
    rerender(
      inTheme(
        <StrictMode>
          <StoryBoard storyId="abc12" view={newer} refreshFailed={false} refetch={refetch} />
        </StrictMode>,
      ),
    );
    expect(screen.queryByText(/That passage can't be sent/)).not.toBeInTheDocument();
    expect(field).toHaveValue("My own words");

    await user.click(send);
    goodSend.finish(jsonResponse(201, { passageId: "c9" }));
    await waitFor(() => {
      expect(field).toHaveValue("");
    });
    expect(newParagraph).not.toBeChecked();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/stories/abc12/passages",
      expect.objectContaining({
        body: JSON.stringify({ text: "My own words", turnVersion: 4, startsParagraph: true }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Suggest continuations" }));
    expect(await screen.findByText("It's no longer your turn.")).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("skips a holder, and says nothing was skipped when the turn had moved on", async () => {
    const staleSkip = inFlight();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(staleSkip.response)
      .mockResolvedValueOnce(noContentResponse());
    vi.stubGlobal("fetch", fetchMock);
    const refetch = renderBoard(someoneElsesTurn);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Skip Sam" }));
    expect(await screen.findByRole("button", { name: "Skipping…" })).toBeDisabled();
    staleSkip.finish(jsonResponse(409, { error: "stale_turn" }));
    expect(await screen.findByText(/nothing was skipped/)).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Skip Sam" }));
    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/nothing was skipped/)).not.toBeInTheDocument();
    for (const call of [1, 2]) {
      expect(fetchMock).toHaveBeenNthCalledWith(
        call,
        "/api/stories/abc12/skip",
        expect.objectContaining({ body: JSON.stringify({ turnVersion: 5 }) }),
      );
    }
  });

  describe("leaving the story", () => {
    beforeEach(() => {
      replace.mockClear();
      takeLeftStoryNote();
    });

    it("asks first, keeps the story on a failure, then leaves and goes home", async () => {
      const failedLeave = inFlight();
      const offlineLeave = inFlight();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockReturnValueOnce(failedLeave.response)
        .mockReturnValueOnce(offlineLeave.response)
        .mockResolvedValueOnce(noContentResponse());
      vi.stubGlobal("fetch", fetchMock);
      const refetch = vi.fn<() => void>();
      const { rerender } = renderPage(
        <StrictMode>
          <StoryBoard storyId="abc12" view={myTurn} refreshFailed={false} refetch={refetch} />
        </StrictMode>,
      );
      const user = userEvent.setup();

      const first = await openDialog(user);
      // StrictMode mounts, cleans up and mounts again; the dialog must survive that.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(first.dialog).toBeInTheDocument();
      expect(first.dialog).toHaveTextContent(
        "You’ll drop out of the turn order. It’s your turn now, so it passes to Kim.",
      );
      expect(first.dialog).toHaveTextContent("You can rejoin from the invite link.");

      await user.keyboard("{Escape}");
      await expectClosed();
      const second = await openDialog(user);
      await user.click(within(second.dialog).getByText("Cancel"));
      await expectClosed();
      expect(fetchMock).not.toHaveBeenCalled();

      const third = await openDialog(user);
      await user.click(within(third.dialog).getByRole("button", { name: "Leave story" }));
      expect(await within(third.dialog).findByRole("button", { name: "Leaving…" })).toBeDisabled();
      failedLeave.finish(jsonResponse(409, { error: "stale_turn" }));
      await waitFor(() => {
        expect(within(third.dialog).getByRole("alert")).toHaveTextContent(
          "The story changed just now.",
        );
      });
      expect(within(third.dialog).getByRole("button", { name: "Leave story" })).toBeEnabled();
      expect(refetch).toHaveBeenCalledOnce();
      expect(replace).not.toHaveBeenCalled();

      await user.click(within(third.dialog).getByRole("button", { name: "Leave story" }));
      expect(await within(third.dialog).findByRole("button", { name: "Leaving…" })).toBeDisabled();
      expect(within(third.dialog).getByRole("alert")).toHaveTextContent(/^$/);
      offlineLeave.fail(new TypeError("offline"));
      await waitFor(() => {
        expect(within(third.dialog).getByRole("alert")).toHaveTextContent(
          "Can't reach the server.",
        );
      });
      expect(refetch).toHaveBeenCalledOnce();

      await user.click(within(third.dialog).getByText("Cancel"));
      await expectClosed();
      // The reload brought a story in which nobody else can take the turn.
      rerender(
        inTheme(
          <StrictMode>
            <StoryBoard
              storyId="abc12"
              view={storyView({
                participants: [ME, OTHER],
                holderId: ME,
                lastWriterId: OTHER,
                version: 4,
              })}
              refreshFailed={false}
              refetch={refetch}
            />
          </StrictMode>,
        ),
      );

      const reopened = await openDialog(user);
      expect(reopened.dialog).not.toHaveTextContent("Can't reach the server");
      expect(reopened.dialog).toHaveTextContent(
        "No one else can take it, so the story will wait for someone to join.",
      );
      await user.click(within(reopened.dialog).getByRole("button", { name: "Leave story" }));

      await waitFor(() => {
        expect(replace).toHaveBeenCalledWith("/");
      });
      expect(takeLeftStoryNote()).toBe(true);
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/stories/abc12/leave",
        expect.objectContaining({ method: "POST", body: "{}" }),
      );
    });
  });
});

function renderBoard(
  view = someoneElsesTurn,
  refreshFailed = false,
  refetch = vi.fn<() => void>(),
) {
  renderPage(
    <StoryBoard storyId="abc12" view={view} refreshFailed={refreshFailed} refetch={refetch} />,
  );

  return refetch;
}

/** A request the test settles itself, so it can look at the screen while the request is in flight. */
function inFlight() {
  const { promise, resolve, reject } = Promise.withResolvers<Response>();

  return { response: promise, finish: resolve, fail: reject };
}

// Tamagui's `DialogClose` names every close button "Dialog Close" (#26), so the dialog's Cancel is
// found by its visible text. The plain "Leave story" button inside the dialog keeps its own name.
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Leave story" }));

  return { dialog: await screen.findByRole("alertdialog", { name: "Leave this story?" }) };
}

async function expectClosed() {
  await waitFor(() => {
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
}
