// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../client/testFixtures";
import { JoinForm } from "./JoinForm";
import { renderPage } from "./testRender";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submitName(name: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), name);
  await user.click(screen.getByRole("button", { name: "Join" }));
}

describe("JoinForm", () => {
  it("asks for a name and does not call the server for an empty one", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Join" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("joins with the trimmed name and reports success", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(201, { participantId: "p1" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onJoined = vi.fn<() => void>();
    renderPage(<JoinForm storyId="abc12" onJoined={onJoined} />);

    await submitName("  Sam ");

    await waitFor(() => {
      expect(onJoined).toHaveBeenCalledOnce();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/participants",
      expect.objectContaining({ body: JSON.stringify({ displayName: "Sam" }) }),
    );
  });

  it("treats a browser that already joined as joined", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "already_joined" })));
    const onJoined = vi.fn<() => void>();
    renderPage(<JoinForm storyId="abc12" onJoined={onJoined} />);

    await submitName("Sam");

    await waitFor(() => {
      expect(onJoined).toHaveBeenCalledOnce();
    });
  });

  it("explains a taken name and lets the user try another", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "name_taken" })));
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    await submitName("Sam");

    expect(await screen.findByRole("alert")).toHaveTextContent("already uses that name");
    expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
  });

  it("shows a full story message and offers no retry", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "story_full" })));
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    await submitName("Sam");

    expect(await screen.findByRole("alert")).toHaveTextContent("This story is full (50 writers).");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });
});
