// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorySummary } from "../../shared/api";
import { justLeftStory, navigateHomeAfterLeaving } from "../router";
import { jsonResponse } from "../testFixtures";
import { NewStory } from "./NewStory";

afterEach(() => {
  vi.unstubAllGlobals();
});

const HOUR_MS = 60 * 60 * 1000;

function summary(overrides: Partial<StorySummary>): StorySummary {
  return {
    id: "abc12",
    opening: "The lighthouse keeper found a letter.",
    holderName: null,
    isMyTurn: false,
    endsAt: null,
    writerCount: 1,
    ...overrides,
  };
}

function stubStories(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

describe("NewStory", () => {
  it("shows neither the pitch nor a list until the stories have loaded, but the form at once", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
    );

    render(<NewStory />);

    expect(screen.queryByRole("heading", { name: /write it together/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
  });

  it("shows the pitch to a writer with no stories", async () => {
    stubStories(jsonResponse(200, { stories: [] }));

    render(<NewStory />);

    expect(await screen.findByRole("heading", { name: /write it together/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
  });

  it("lists the writer's stories in place of the pitch, each with its status", async () => {
    stubStories(
      jsonResponse(200, {
        stories: [
          summary({
            id: "aaaaa",
            opening: "Mine to write.",
            holderName: "Me",
            isMyTurn: true,
            endsAt: Date.now() + HOUR_MS + 30_000,
            writerCount: 2,
          }),
          summary({
            id: "bbbbb",
            opening: "Ben has it.",
            holderName: "Ben",
            endsAt: Date.now() + HOUR_MS,
            writerCount: 3,
          }),
          summary({ id: "ccccc", opening: "Nobody yet." }),
        ],
      }),
    );

    render(<NewStory />);

    const region = await screen.findByRole("region", { name: "Your stories" });
    const links = within(region).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/aaaaa", "/bbbbb", "/ccccc"]);
    expect(links[0]).toHaveTextContent("Mine to write.");
    expect(links[0]).toHaveTextContent("Your turn · 1h 0m left");
    expect(links[1]).toHaveTextContent("Ben’s turn · 3 writers");
    expect(links[2]).toHaveTextContent("Waiting for someone to join");
    expect(screen.queryByRole("heading", { name: /write it together/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a new story" })).toBeInTheDocument();
  });

  it("opens a story from the list without reloading the page", async () => {
    stubStories(jsonResponse(200, { stories: [summary({ id: "abc12" })] }));
    render(<NewStory />);

    await userEvent.setup().click(await screen.findByRole("link", { name: /lighthouse keeper/ }));

    expect(window.location.pathname).toBe("/abc12");
  });

  it("says the stories didn't load, keeps the form, and loads them again on retry", async () => {
    const fetchMock = stubStories(
      jsonResponse(500, { error: "internal_error" }),
      jsonResponse(200, { stories: [summary({})] }),
    );
    render(<NewStory />);

    expect(await screen.findByText("Couldn't load your stories.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /write it together/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Your stories" })).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says the writer left a story, once", async () => {
    stubStories(jsonResponse(200, { stories: [] }));
    window.history.replaceState(null, "", "/abc12");
    navigateHomeAfterLeaving();

    render(<NewStory />);

    expect(await screen.findByRole("status")).toHaveTextContent("You left the story.");
    expect(justLeftStory()).toBe(false);
  });

  it("says nothing about leaving when the writer arrived any other way", async () => {
    stubStories(jsonResponse(200, { stories: [] }));
    window.history.replaceState(null, "", "/");

    render(<NewStory />);

    await screen.findByRole("heading", { name: /write it together/i });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
