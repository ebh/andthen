// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { replace } from "./routerStub";
import { StoryBoard } from "./StoryBoard";
import { inTheme, renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

// The hook opens a real WebSocket; its logic is covered in live.test.ts and useStoryLive.test.tsx.
vi.mock("../client/useStoryLive", () => ({ useStoryLive: vi.fn<() => void>() }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const myTurn = storyView({ participants: [ME, OTHER, THIRD], holderId: ME, lastWriterId: OTHER });

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

describe("composer", () => {
  it("counts graphemes live and disables send when empty or over the limit", async () => {
    renderBoard(myTurn);
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
    const refetch = renderBoard(myTurn);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "And then.");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Your passage")).toHaveValue("");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/contributions",
      expect.objectContaining({
        body: JSON.stringify({ text: "And then.", turnVersion: 3, startsParagraph: false }),
      }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("sends startsParagraph when New paragraph is ticked, then unticks it after sending", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(noContentResponse()));
    vi.stubGlobal("fetch", fetchMock);
    renderBoard(myTurn);
    const user = userEvent.setup();
    const box = screen.getByRole("checkbox", { name: "New paragraph" });

    await user.click(box);
    await user.type(screen.getByLabelText("Your passage"), "A fresh start.");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    await waitFor(() => {
      expect(box).not.toBeChecked();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/contributions",
      expect.objectContaining({
        body: JSON.stringify({ text: "A fresh start.", turnVersion: 3, startsParagraph: true }),
      }),
    );
  });

  it("keeps New paragraph ticked when the send fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "stale_turn" })));
    renderBoard(myTurn);
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox", { name: "New paragraph" }));
    await user.type(screen.getByLabelText("Your passage"), "Precious words");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    expect(await screen.findByText(/The story changed while you were writing/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "New paragraph" })).toBeChecked();
  });

  it("offers no New paragraph box when it is not your turn", () => {
    renderBoard(storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME }));

    expect(screen.queryByRole("checkbox", { name: "New paragraph" })).not.toBeInTheDocument();
  });

  it("keeps the text and refetches on a 409 stale_turn", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "stale_turn" })));
    const refetch = renderBoard(myTurn);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "Precious words");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    expect(await screen.findByText(/The story changed while you were writing/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your passage")).toHaveValue("Precious words");
    expect(refetch).toHaveBeenCalled();
  });

  it("explains a 403 not_your_turn differently, keeps the text and refetches", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(403, { error: "not_your_turn" })));
    const refetch = renderBoard(myTurn);
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
    renderBoard(myTurn);
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

async function askAndPick(user: ReturnType<typeof userEvent.setup>, pick: string) {
  await user.click(screen.getByRole("button", { name: "Suggest continuations" }));
  await user.click(await screen.findByRole("button", { name: pick }));
}

describe("replacing a draft with a suggestion", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(jsonResponse(200, { suggestions: ["One.", "Two.", "Three."] })),
    );
  });

  it("offers Undo that restores the typed draft", async () => {
    renderBoard(myTurn);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Your passage");

    await user.type(field, "My own words");
    await askAndPick(user, "Two.");

    expect(field).toHaveValue("Two.");
    expect(field).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(field).toHaveValue("My own words");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("offers no Undo when the composer was empty", async () => {
    renderBoard(myTurn);

    await askAndPick(userEvent.setup(), "Two.");

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("drops the Undo once the user edits the text", async () => {
    renderBoard(myTurn);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "Draft");
    await askAndPick(user, "Two.");
    await user.type(screen.getByLabelText("Your passage"), "!");

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});

describe("stale pages and notices", () => {
  it("refetches on 403 not_participant from a contribution, so the page can show the join form", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(403, { error: "not_participant" })));
    const refetch = renderBoard(myTurn);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "Words");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    expect(await screen.findByText(/not part of this story/)).toBeInTheDocument();
    expect(refetch).toHaveBeenCalled();
  });

  it("clears the notice once the story shows a new turn version", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "stale_turn" })));
    const refetch = vi.fn<() => void>();
    const { rerender } = renderPage(
      <StoryBoard storyId="abc12" view={myTurn} refreshFailed={false} refetch={refetch} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your passage"), "Words");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));
    expect(await screen.findByText(/The story changed while you were writing/)).toBeInTheDocument();

    const newer = storyView({
      participants: [ME, OTHER, THIRD],
      holderId: ME,
      lastWriterId: OTHER,
      version: 4,
    });
    rerender(
      inTheme(<StoryBoard storyId="abc12" view={newer} refreshFailed={false} refetch={refetch} />),
    );

    expect(screen.queryByText(/The story changed while you were writing/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your passage")).toHaveValue("Words");
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

describe("leaving the story", () => {
  beforeEach(() => {
    replace.mockClear();
    takeLeftStoryNote();
  });

  it("asks first, and says who gets the turn when the writer holds it", async () => {
    renderBoard(myTurn);

    const { dialog } = await openDialog();

    expect(dialog).toHaveTextContent("passes to Kim");
  });

  it("does not talk about the turn when someone else holds it", async () => {
    renderBoard(storyView({ participants: [ME, OTHER, THIRD], holderId: OTHER, lastWriterId: ME }));

    const { dialog } = await openDialog();

    expect(dialog).not.toHaveTextContent("your turn now");
  });

  it("closes without leaving on Cancel", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderBoard();
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves, then goes home with a note", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(noContentResponse()));
    vi.stubGlobal("fetch", fetchMock);
    renderBoard();
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Leave story" }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/");
    });
    expect(takeLeftStoryNote()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/leave",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("stays open with a message, and reloads the story, when the story moved on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(409, { error: "stale_turn" }))),
    );
    const refetch = renderBoard();
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Leave story" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The story changed just now.",
    );
    expect(refetch).toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Leave story" })).toBeEnabled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays open with a generic message when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline"))),
    );
    const refetch = renderBoard();
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Leave story" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Can't reach the server.");
    expect(refetch).not.toHaveBeenCalled();
  });

  it("forgets an earlier failure when the dialog is opened again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(409, { error: "stale_turn" }))),
    );
    renderBoard();
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByRole("button", { name: "Leave story" }));
    await within(dialog).findByText(/The story changed just now/);
    await user.click(within(dialog).getByText("Cancel"));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    const reopened = await openDialog();

    expect(reopened.dialog).not.toHaveTextContent("The story changed just now");
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

describe("a writer who left in another tab", () => {
  it("reloads the story when sending a passage finds they left, and keeps the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          jsonResponse(403, { error: "left_story", displayName: "Me", opening: "Once." }),
        ),
      ),
    );
    const refetch = renderBoard(myTurn);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Your passage"), "And then.");
    await user.click(screen.getByRole("button", { name: "Add to the story" }));

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
    expect(screen.getByLabelText("Your passage")).toHaveValue("And then.");
  });
});

// Tamagui's `DialogClose` names every close button "Dialog Close" (#26), so the dialog's Cancel is
// found by its visible text. The plain "Leave story" button inside the dialog keeps its own name.
async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Leave story" }));

  return { user, dialog: await screen.findByRole("alertdialog", { name: "Leave this story?" }) };
}
