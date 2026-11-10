// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ME, OTHER, jsonResponse, noContentResponse, storyView } from "../client/testFixtures";
import { params } from "./routerStub";
import { Story } from "./Story";
import { renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

beforeEach(() => {
  params["storyId"] = "abc12";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const view = storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME });

describe("Story", () => {
  it("shows a status while the story loads", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    renderPage(<Story />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading the story…");
  });

  it("shows the board to a participant", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(200, view)));
    renderPage(<Story />);

    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
  });

  it("asks for a name from a browser that hasn't joined, then shows the board after joining", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(403, { error: "not_participant" }))
      .mockResolvedValueOnce(jsonResponse(200, { displayName: null }))
      .mockResolvedValueOnce(jsonResponse(201, { participantId: ME }))
      .mockResolvedValueOnce(jsonResponse(200, view));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(<Story />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Your name"), "Me");
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/stories/abc12",
      "/api/users/me",
      "/api/stories/abc12/participants",
      "/api/stories/abc12",
    ]);
  });

  it("offers a writer who left their old name, then shows the story once they rejoin", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(403, {
          error: "left_story",
          displayName: "Ana",
          opening: "Once.",
          openingAuthorId: "u1",
        }),
      )
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(jsonResponse(200, view));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(<Story />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Rejoin as Ana" }));

    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/stories/abc12",
      "/api/stories/abc12/rejoin",
      "/api/stories/abc12",
    ]);
  });

  it("says a missing story doesn't exist", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(404, { error: "not_found" })));
    renderPage(<Story />);

    expect(await screen.findByText(/That story doesn't exist/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Not found" })).toBeInTheDocument();
  });

  it("offers another try when the load fails, and loads again", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(200, view));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(<Story />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
  });

  it("looks the story up by its lowercase ID", async () => {
    params["storyId"] = "ABC12";
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(200, view)));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(<Story />);

    await screen.findByLabelText("Invite link");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/stories/abc12");
  });

  it("shows the not-found page for an address that is no story ID, without calling the server", () => {
    params["storyId"] = "nowhere";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderPage(<Story />);

    expect(screen.getByText("There's nothing at this address.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
