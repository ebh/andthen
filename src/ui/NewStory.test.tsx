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
const PITCH = /write it together/i;

beforeEach(() => {
  resetClerk();
  push.mockClear();
  takeLeftStoryNote();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The wording of each name failure is messages.test.ts's, how a name is read is userName.test.ts's,
// and how a passage is counted and trimmed is validation.test.ts's. These sessions check that the
// screen shows one case of each, in the order a person meets them.
describe("NewStory", () => {
  // Pins the first visit: nothing is offered until the browser has answered, every way a submit
  // can fail leaves the form usable, and a stale name is fixed by reloading it. Without it a
  // submit could go out before the name is known, or an error could leave the form stuck.
  it("walks a new writer on a phone from loading to a started story", async () => {
    const api = stubApi();
    const stories = inFlight();
    const me = inFlight();
    const offline = inFlight();
    const staleName = inFlight();
    api.queue("stories", stories.response);
    api.queue("me", me.response, jsonResponse(200, { displayName: "Ada" }));
    api.queue(
      "create",
      offline.response,
      staleName.response,
      jsonResponse(201, { storyId: "abc12" }),
    );
    renderPage(<NewStory />);
    const user = userEvent.setup();
    const opening = screen.getByLabelText("Opening passage");
    const start = screen.getByRole("button", { name: "Start the story" });

    // Loading: the form shows at once, the pitch and the list wait, and the name is being checked.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
    expect(screen.getByText("0 / 280")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: PITCH })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    await user.type(opening, "  It began. ");
    expect(start).toBeDisabled();

    // Loaded with nothing to list: the pitch, the sign-in offer and the name field.
    stories.finish(jsonResponse(200, { stories: [], nextCursor: null }));
    me.finish(jsonResponse(200, { displayName: null }));
    const name = await screen.findByLabelText("Your name");
    expect(await screen.findByRole("heading", { name: PITCH })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "How it works" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "support@andthen.page" })).toHaveAttribute(
      "href",
      "mailto:support@andthen.page",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(start).toBeEnabled();

    // No name: asked for before any request goes out.
    await user.click(start);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    expect(api.sent("create")).toEqual([]);

    // Enter submits. While the request is held the button says so, the last error is gone, and a
    // second Enter sends nothing more. The name and the passage go out trimmed.
    await user.type(name, "  Ada ");
    await user.type(name, "{Enter}");
    expect(await screen.findByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/^$/);
    await user.type(name, "{Enter}");
    expect(api.sent("create")).toHaveLength(1);
    expect(api.sent("create")[0]?.body).toBe(
      JSON.stringify({ displayName: "Ada", opening: "It began." }),
    );

    // Offline: the typed text stays, the name is not reloaded and the button works again.
    offline.fail(new TypeError("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(start).toBeEnabled();
    expect(name).toHaveValue("  Ada ");
    expect(opening).toHaveValue("  It began. ");
    expect(api.sent("me")).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();

    // Exactly at the limit is fine. One over is flagged once, the start button held, and Enter
    // sends nothing.
    await user.clear(opening);
    await user.click(opening);
    await user.paste("x".repeat(280));
    expect(screen.getByText("280 / 280")).toBeInTheDocument();
    expect(start).toBeEnabled();
    await user.type(opening, "x");
    expect(screen.getByText("281 / 280 (too long)")).toBeInTheDocument();
    expect(screen.getAllByText(/too long/)).toHaveLength(1);
    expect(start).toBeDisabled();
    await user.type(name, "{Enter}");
    expect(api.sent("create")).toHaveLength(1);
    await user.clear(opening);
    await user.type(opening, "It began.");
    expect(screen.getByText("9 / 280")).toBeInTheDocument();

    // The name was set elsewhere: the server refuses the one sent, and the form reloads the name.
    await user.click(start);
    staleName.finish(jsonResponse(400, { error: "bad_request" }));
    await waitFor(() => {
      expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Check your name and try again.");
    expect(api.sent("me")).toHaveLength(2);
    await waitFor(() => {
      expect(start).toBeEnabled();
    });

    // Sent again, the request carries no name and the app opens the story.
    await user.click(start);
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/abc12");
    });
    expect(api.sent("create")[2]?.body).toBe(JSON.stringify({ opening: "It began." }));
  });

  // Pins what a returning writer sees on a wide screen: their stories in place of the pitch, a
  // page of them at a time, and a clean slate after signing out. Without it the list, its status
  // lines or the reload after sign-out could break unnoticed.
  it("lists a signed-in writer's stories on a wide screen, pages through them, then signs out", async () => {
    setScreen({ wide: true, hover: true });
    clerk.isSignedIn = true;
    clerk.email = "ana@example.com";
    vi.mocked(clerk.signOut).mockImplementation(() => {
      clerk.isSignedIn = false;

      return Promise.resolve();
    });
    const api = stubApi();
    const failedPage = inFlight();
    api.queue(
      "stories",
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
        nextCursor: "c1",
      }),
      failedPage.response,
      jsonResponse(200, {
        stories: [summary({ id: "ddddd", opening: "Fourth." })],
        nextCursor: null,
      }),
      jsonResponse(200, { stories: [], nextCursor: null }),
    );
    api.queue("me", jsonResponse(200, { displayName: "Ana" }));
    renderPage(<NewStory />);
    const user = userEvent.setup();

    const region = await screen.findByRole("region", { name: "Your stories" });
    expect(within(region).getByRole("heading", { name: "Your stories" })).toBeInTheDocument();
    const links = within(region).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/aaaaa", "/bbbbb", "/ccccc"]);
    expect(links[0]).toHaveTextContent("Mine to write.");
    expect(links[0]).toHaveTextContent("Your turn · 1h 0m left");
    expect(links[1]).toHaveTextContent("Ben’s turn · 3 writers");
    expect(links[2]).toHaveTextContent("Waiting for someone to join");
    expect(screen.queryByRole("heading", { name: PITCH })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a new story" })).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    // A page that fails to load: the button is held while it loads, then the list is unchanged.
    expect(within(region).getByRole("alert")).toHaveTextContent(/^$/);
    await user.click(within(region).getByRole("button", { name: "Show more" }));
    expect(within(region).getByRole("button", { name: "Loading…" })).toBeDisabled();
    expect(within(region).getByRole("alert")).toHaveTextContent(/^$/);
    failedPage.finish(jsonResponse(500, { error: "internal_error" }));
    expect(await within(region).findByText("Couldn’t load more stories.")).toBeInTheDocument();
    expect(within(region).getAllByRole("link")).toHaveLength(3);

    // Tried again, the next page joins the list and the button and the message go.
    await user.click(within(region).getByRole("button", { name: "Show more" }));
    await waitFor(() => {
      expect(within(region).getAllByRole("link")).toHaveLength(4);
    });
    expect(within(region).queryByRole("button")).not.toBeInTheDocument();
    expect(within(region).queryByText("Couldn’t load more stories.")).not.toBeInTheDocument();
    expect(api.sent("stories").map((request) => request.url)).toEqual([
      "/api/stories",
      "/api/stories?cursor=c1",
      "/api/stories?cursor=c1",
    ]);

    // Signing out: the stories and the name load again for the browser that is left.
    api.queue("me", jsonResponse(200, { displayName: null }));
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: PITCH })).toBeInTheDocument();
    expect(clerk.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Your stories" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "How it works" }))
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual([
      "1Start with an opening passage",
      "2Invite friends with a link",
      "3Take turns, up to 280 characters each",
    ]);
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByText("ana@example.com")).not.toBeInTheDocument();
    expect(api.sent("stories")).toHaveLength(4);
    expect(api.sent("me")).toHaveLength(2);
  });

  // Pins the landing after leaving a story when the list cannot load: the note shows once, the
  // failure has its own message and retry, and the form stays usable throughout.
  it("tells a writer who left a story so once, and recovers when their stories fail to load", async () => {
    setLeftStoryNote();
    const api = stubApi();
    api.queue(
      "stories",
      jsonResponse(500, { error: "internal_error" }),
      jsonResponse(200, { stories: [summary({})], nextCursor: null }),
    );
    const { unmount } = renderPage(<NewStory />);
    const user = userEvent.setup();

    expect(await screen.findByText("Couldn't load your stories.")).toBeInTheDocument();
    expect(screen.getByText("You left the story.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: PITCH })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a story" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByLabelText("Opening passage")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("region", { name: "Your stories" })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your stories.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a new story" })).toBeInTheDocument();
    expect(api.sent("stories")).toHaveLength(2);
    unmount();

    renderPage(<NewStory />);
    expect(await screen.findByRole("heading", { name: PITCH })).toBeInTheDocument();
    expect(screen.queryByText("You left the story.")).not.toBeInTheDocument();
  });
});

type Route = "stories" | "me" | "create";
type Reply = Response | Promise<Response>;

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

/**
 * Stubs `fetch` for the three calls the page makes. Each route answers its queued replies in
 * order, then a default: no stories, a user with no name, and an error for a create nobody queued.
 */
function stubApi() {
  const queued: { [route in Route]: Reply[] } = { stories: [], me: [], create: [] };
  const sent: { route: Route; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const route = routeOf(url, init);
    sent.push({ route, url, body: init?.body });

    return Promise.resolve(queued[route].shift() ?? defaultReply(route));
  });

  return {
    queue: (route: Route, ...replies: Reply[]) => {
      queued[route].push(...replies);
    },
    sent: (route: Route) => sent.filter((request) => request.route === route),
  };
}

function routeOf(url: string, init: RequestInit | undefined): Route {
  if (url === "/api/users/me") {
    return "me";
  }

  return init?.method === "POST" ? "create" : "stories";
}

function defaultReply(route: Route): Response {
  if (route === "create") {
    throw new Error("A create nobody queued reached the server.");
  }

  return route === "me"
    ? jsonResponse(200, { displayName: null })
    : jsonResponse(200, { stories: [], nextCursor: null });
}

/** A request the test settles itself, so it can look at the screen while the request is in flight. */
function inFlight() {
  const { promise, resolve, reject } = Promise.withResolvers<Response>();

  return { response: promise, finish: resolve, fail: reject };
}
