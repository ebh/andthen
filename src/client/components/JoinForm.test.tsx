// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../testFixtures";
import { JoinForm } from "./JoinForm";

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
    render(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

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
    render(<JoinForm storyId="abc12" onJoined={onJoined} />);

    await submitName("  Sam ");

    await waitFor(() => {
      expect(onJoined).toHaveBeenCalledOnce();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stories/abc12/participants",
      expect.objectContaining({ body: JSON.stringify({ displayName: "Sam" }) }),
    );
  });

  it("explains a taken name and lets the user try another", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "name_taken" })));
    render(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    await submitName("Sam");

    expect(await screen.findByRole("alert")).toHaveTextContent("already uses that name");
    expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
  });

  it("shows a full story message and offers no retry", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(409, { error: "story_full" })));
    render(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    await submitName("Sam");

    expect(await screen.findByRole("alert")).toHaveTextContent("This story is full (50 writers).");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });
});
