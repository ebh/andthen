// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLeftStoryNote, takeLeftStoryNote } from "../client/leftStoryNote";
import { jsonResponse } from "../client/testFixtures";
import type { StorySummary } from "../shared/api";
import { clerk, resetClerk } from "./clerkStub";
import { NewStory } from "./NewStory";
import { push } from "./routerStub";
import { renderPage } from "./testRender";
import { setScreen } from "./testScreen";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);
vi.mock("@clerk/expo", async () => (await import("./clerkStub")).clerkModule);

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  resetClerk();
  push.mockClear();
  takeLeftStoryNote();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** Stubs `fetch`: the first reply answers the list of the writer's stories (none by default), the rest follow in order. */
function stubFetch(stories: Response | null = null, ...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(jsonResponse(200, { stories: [], nextCursor: null })),
  );
  fetchMock.mockResolvedValueOnce(stories ?? jsonResponse(200, { stories: [], nextCursor: null }));
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function createCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

async function fillIn(name: string, opening: string) {
  const user = userEvent.setup();
  if (name !== "") {
    await user.type(screen.getByLabelText("Your name"), name);
  }
  if (opening !== "") {
    await user.type(screen.getByLabelText("Opening passage"), opening);
  }

  return user;
}

describe("NewStory", () => {
  it("has the wordmark as its level-1 heading, then the pitch and the form title", async () => {
    renderPage(<NewStory />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(await screen.findByRole("heading", { name: /write it together/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
  });

  it("keeps the submit button disabled until there is an opening passage", async () => {
    renderPage(<NewStory />);
    const submit = screen.getByRole("button", { name: "Start the story" });
    expect(submit).toBeDisabled();

    await fillIn("Ada", "It began.");

    expect(submit).toBeEnabled();
  });

  it("counts the passage and flags one that is too long", async () => {
    renderPage(<NewStory />);
    expect(screen.getByText("0 / 280")).toBeInTheDocument();

    await fillIn("", "x".repeat(281));

    expect(screen.getByText("281 / 280 (too long)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the story" })).toBeDisabled();
  });

  it("asks for a name before calling the server", async () => {
    const fetchMock = stubFetch();
    renderPage(<NewStory />);

    const user = await fillIn("", "It began.");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name.");
    expect(createCalls(fetchMock)).toEqual([]);
  });

  it("rejects a name that is too long before calling the server", async () => {
    const fetchMock = stubFetch();
    renderPage(<NewStory />);

    const user = await fillIn("n".repeat(41), "It began.");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Names can be at most 40 characters.",
    );
    expect(createCalls(fetchMock)).toEqual([]);
  });

  it("creates the story with the trimmed name and passage, then opens it", async () => {
    const fetchMock = stubFetch(null, jsonResponse(201, { storyId: "abc12" }));
    renderPage(<NewStory />);

    const user = await fillIn("  Ada ", "  It began. ");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/abc12");
    });
    expect(createCalls(fetchMock)).toHaveLength(1);
    expect(createCalls(fetchMock)[0]?.[1]?.body).toBe(
      JSON.stringify({ displayName: "Ada", opening: "It began." }),
    );
  });

  it("submits from the keyboard", async () => {
    stubFetch(null, jsonResponse(201, { storyId: "abc12" }));
    renderPage(<NewStory />);

    const user = await fillIn("Ada", "It began.");
    await user.type(screen.getByLabelText("Your name"), "{Enter}");

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/abc12");
    });
  });

  it("says the server is unreachable and keeps what was typed", async () => {
    stubFetch().mockRejectedValueOnce(new TypeError("offline"));
    renderPage(<NewStory />);

    const user = await fillIn("Ada", "It began.");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Your name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Opening passage")).toHaveValue("It began.");
    expect(screen.getByRole("button", { name: "Start the story" })).toBeEnabled();
  });

  it("shows a generic message when the server rejects the request", async () => {
    stubFetch(null, jsonResponse(500, { error: "internal_error" }));
    renderPage(<NewStory />);

    const user = await fillIn("Ada", "It began.");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("lists the three steps on a wide screen", async () => {
    setScreen({ wide: true, hover: true });
    renderPage(<NewStory />);

    const steps = await screen.findByRole("list", { name: "How it works" });

    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual([
      "1Start with an opening passage",
      "2Invite friends with a link",
      "3Take turns, up to 280 characters each",
    ]);
  });

  it("drops the steps on a phone, where the form follows the headline", async () => {
    renderPage(<NewStory />);
    await screen.findByRole("heading", { name: /write it together/i });

    expect(screen.queryByRole("list", { name: "How it works" })).not.toBeInTheDocument();
  });

  it("shows neither the pitch nor a list until the stories have loaded, but the form at once", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined)),
    );
    renderPage(<NewStory />);

    expect(screen.queryByRole("heading", { name: /write it together/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
  });

  it("shows the pitch to a writer with no stories", async () => {
    renderPage(<NewStory />);

    expect(await screen.findByRole("heading", { name: /write it together/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
  });

  it("lists the writer's stories in place of the pitch, each with its status", async () => {
    stubFetch(
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
        nextCursor: null,
      }),
    );
    renderPage(<NewStory />);

    const region = await screen.findByRole("region", { name: "Your stories" });
    expect(within(region).getByRole("heading", { name: "Your stories" })).toBeInTheDocument();
    const links = within(region).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/aaaaa", "/bbbbb", "/ccccc"]);
    expect(links[0]).toHaveTextContent("Mine to write.");
    expect(links[0]).toHaveTextContent("Your turn · 1h 0m left");
    expect(links[1]).toHaveTextContent("Ben’s turn · 3 writers");
    expect(links[2]).toHaveTextContent("Waiting for someone to join");
    expect(screen.queryByRole("heading", { name: /write it together/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a new story" })).toBeInTheDocument();
  });

  it("shows more stories on request, says when a page fails, and drops the button on the last page", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        stories: [summary({ id: "aaaaa", opening: "First." })],
        nextCursor: "c1",
      }),
      jsonResponse(500, { error: "internal_error" }),
      jsonResponse(200, {
        stories: [summary({ id: "bbbbb", opening: "Second." })],
        nextCursor: null,
      }),
    );
    renderPage(<NewStory />);
    const user = userEvent.setup();
    const region = await screen.findByRole("region", { name: "Your stories" });

    await user.click(within(region).getByRole("button", { name: "Show more" }));

    expect(await within(region).findByText("Couldn’t load more stories.")).toBeInTheDocument();
    expect(within(region).getAllByRole("link")).toHaveLength(1);

    await user.click(within(region).getByRole("button", { name: "Show more" }));

    await waitFor(() => {
      expect(within(region).getAllByRole("link")).toHaveLength(2);
    });
    expect(within(region).queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(within(region).queryByText("Couldn’t load more stories.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/stories?cursor=c1", expect.anything());
  });

  it("says the stories didn't load, keeps the form, and loads them again on retry", async () => {
    const fetchMock = stubFetch(
      jsonResponse(500, { error: "internal_error" }),
      jsonResponse(200, { stories: [summary({})], nextCursor: null }),
    );
    renderPage(<NewStory />);

    const message = await screen.findByText("Couldn't load your stories.");
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /write it together/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("region", { name: "Your stories" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says the writer left a story, once", async () => {
    setLeftStoryNote();
    const { unmount } = renderPage(<NewStory />);

    expect(await screen.findByRole("status")).toHaveTextContent("You left the story.");
    unmount();

    renderPage(<NewStory />);
    await screen.findByRole("heading", { name: /write it together/i });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers sign-in to someone who is signed out", async () => {
    renderPage(<NewStory />);

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("shows the account and loads the stories again after signing out", async () => {
    clerk.isSignedIn = true;
    clerk.email = "ana@example.com";
    const fetchMock = stubFetch(
      jsonResponse(200, { stories: [summary({})], nextCursor: null }),
      jsonResponse(200, { stories: [], nextCursor: null }),
    );
    renderPage(<NewStory />);
    await screen.findByRole("region", { name: "Your stories" });
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    });
    expect(clerk.signOut).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says nothing about leaving when the writer arrived any other way", async () => {
    renderPage(<NewStory />);

    await screen.findByRole("heading", { name: /write it together/i });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
