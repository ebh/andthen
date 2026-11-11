// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ME, OTHER, jsonResponse, noContentResponse, storyView } from "../client/testFixtures";
import { params } from "./routerStub";
import { Story } from "./Story";
import { fakeBlocks, inTheme, renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

// The story board opens a live socket; its logic is covered in live.test.ts and useStoryLive.test.tsx.
vi.mock("../client/useStoryLive", () => ({ useStoryLive: vi.fn<() => void>() }));

beforeEach(() => {
  params["storyId"] = "abc12";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const view = storyView({ participants: [ME, OTHER], holderId: OTHER, lastWriterId: ME });
const NOT_PARTICIPANT = { error: "not_participant" };
const LEFT_STORY = {
  error: "left_story",
  displayName: "Ana",
  opening: "The bell rang once.",
  openingAuthorId: "u2",
};
const OPENING_HIDDEN = "Opening passage, hidden because you blocked its author";

// Which screen a story's address shows is useStory's (nextLoad); what a join or rejoin result
// means is joinOutcome's; the wording of a name failure is messages.test.ts's. These sessions
// check that each screen shows one case of each, in the order a person meets them.
describe("Story", () => {
  // Pins the loading and failure screens of an address that is a story: a status while the story
  // loads, a failed load that can be tried again, and the lookup by lowercase ID. Without it a
  // failed load would leave a blank page, or an uppercase address would ask for the wrong story.
  it("loads the story of a joined writer, offering another try after a failure", async () => {
    params["storyId"] = "ABC12";
    const api = stubApi();
    const loading = inFlight();
    api.queue("story", loading.response);
    api.queue("story", jsonResponse(200, view));
    renderPage(<Story />);
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("status")).toHaveTextContent("Loading the story…");
    expect(screen.queryByLabelText("Invite link")).not.toBeInTheDocument();

    loading.fail(new TypeError("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(api.urls("story")).toEqual(["/api/stories/abc12", "/api/stories/abc12"]);
  });

  // Pins both not-found pages in one session: a story the server doesn't know, and an address
  // that is no story ID at all, which must not reach the server. This is also the page the
  // `+not-found` route shows. Without it a bad link would show a blank page or a server error.
  it("says a missing story doesn't exist, and an address that is no story ID has nothing", async () => {
    const api = stubApi();
    api.queue("story", jsonResponse(404, { error: "not_found" }));
    const { rerender } = renderPage(<Story />);

    expect(await screen.findByText(/That story doesn't exist/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("heading", { level: 2, name: "Not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new story" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "And then…" })).toHaveAttribute("href", "/");

    params["storyId"] = "nowhere";
    rerender(inTheme(<Story />));

    expect(screen.getByText("There's nothing at this address.")).toBeInTheDocument();
    expect(screen.queryByText(/That story doesn't exist/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new story" })).toHaveAttribute("href", "/");
    expect(api.urls("story")).toEqual(["/api/stories/abc12"]);
  });

  // Pins the join form for a browser with no name: nothing is offered until the name is known,
  // an empty name is refused before any request, a name the server refuses leaves the form
  // usable, and a join opens the board. Without it a join could go out before the name is known
  // or after a failure the writer can't recover from.
  it("asks a new writer for a name, then shows the board after joining", async () => {
    const api = stubApi();
    const me = inFlight();
    const joining = inFlight();
    api.queue("story", jsonResponse(403, NOT_PARTICIPANT));
    api.queue("me", me.response);
    api.queue("join", joining.response, jsonResponse(201, { participantId: ME }));
    api.queue("story", jsonResponse(200, view));
    renderPage(<Story />);
    const user = userEvent.setup();

    // The user's name is still loading: no field, no prompt, and nothing to press.
    expect(await screen.findByRole("heading", { name: "Join this story" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick a name/)).not.toBeInTheDocument();

    // No name yet: the field and the prompt show, and an empty name is refused without a request.
    me.finish(jsonResponse(200, { displayName: null }));
    const name = await screen.findByLabelText("Your name");
    expect(screen.getByText(/Pick a name/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    expect(api.sent("join")).toEqual([]);

    // Held in flight: the button says so, the last error is gone and the name goes out trimmed.
    await user.type(name, "  Sam ");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("button", { name: "Joining…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/^$/);
    expect(api.sent("join")).toEqual([
      { url: "/api/stories/abc12/participants", body: JSON.stringify({ displayName: "Sam" }) },
    ]);

    // The name is taken: the message suggests signing in, and the writer can try another.
    joining.finish(jsonResponse(409, { error: "name_taken" }));
    expect(await screen.findByText(/sign in/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Someone already uses that name.");
    expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
    expect(screen.getByLabelText("Your name")).toHaveValue("  Sam ");
    expect(api.sent("me")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Join this story" })).not.toBeInTheDocument();
    expect(api.sent("join")).toHaveLength(2);
    expect(api.urls("story")).toHaveLength(2);
  });

  // Pins the join form for a browser whose name is already known: the check can fail and be
  // retried, a known name gets no field and goes out as no name, a name that went stale is
  // reloaded, and a full story ends the attempts. Without it a user who lost their name could
  // never join, or a full story would invite endless retries.
  it("lets a writer with a name join, reloads a stale name, and stops at a full story", async () => {
    const api = stubApi();
    api.queue("story", jsonResponse(403, NOT_PARTICIPANT));
    api.queue(
      "me",
      jsonResponse(500, { error: "internal_error" }),
      jsonResponse(200, { displayName: "Ana" }),
      jsonResponse(200, { displayName: null }),
    );
    api.queue("join", jsonResponse(400, { error: "invalid_display_name" }));
    api.queue("join", jsonResponse(409, { error: "story_full" }));
    renderPage(<Story />);
    const user = userEvent.setup();

    // The name can't be checked: the writer is offered a retry and the join is held back.
    expect(await screen.findByText("Couldn't check your name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    // A known name needs no field, and goes out as no name.
    const join = await screen.findByRole("button", { name: "Join" });
    await vi.waitFor(() => {
      expect(join).toBeEnabled();
    });
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick a name/)).not.toBeInTheDocument();
    await user.click(join);

    // The server calls that name invalid, so the form has lost it elsewhere and asks again.
    const name = await screen.findByLabelText("Your name");
    expect(screen.getByRole("alert")).toHaveTextContent("Check your name and try again.");
    expect(api.sent("join")[0]?.body).toBe("{}");
    expect(api.sent("me")).toHaveLength(3);

    // A full story stays full: the message says so and the button is held for good.
    await user.type(name, "Sam");
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(await screen.findByText("This story is full (50 writers).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
    expect(api.sent("join")[1]?.body).toBe(JSON.stringify({ displayName: "Sam" }));
  });

  // Pins the way back for a writer who left: the old name and story are offered, a failed
  // rejoin leaves a message and a button that still works, and rejoining opens the board. The
  // second address checks that a full story stops the rejoin. Without it a writer who left would
  // be stuck on a blank page, or could press on a full story forever.
  it("offers a writer who left their old name, then shows the story once they rejoin", async () => {
    const api = stubApi();
    const rejoining = inFlight();
    const rejoiningAgain = inFlight();
    api.queue("story", jsonResponse(403, LEFT_STORY));
    api.queue("rejoin", rejoining.response, rejoiningAgain.response);
    api.queue("story", jsonResponse(200, view));
    api.queue("story", jsonResponse(403, { ...LEFT_STORY, openingAuthorId: undefined }));
    api.queue("rejoin", jsonResponse(409, { error: "story_full" }));
    const { rerender } = renderPage(<Story />);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "You left this story" })).toBeInTheDocument();
    expect(screen.getByText("“The bell rang once.”")).toBeInTheDocument();
    expect(screen.getByText(/Rejoin as Ana\. You’ll take the last place/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Your stories" })).toHaveAttribute("href", "/");

    // A blocked opening author, or blocks still loading, keep the opening out of the page.
    const blocked = fakeBlocks({ blocked: [{ id: "b1", blockedUserId: "u2" }] });
    rerender(inTheme(<Story />, blocked));
    expect(screen.queryByText("“The bell rang once.”")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: OPENING_HIDDEN })).toBeInTheDocument();
    rerender(inTheme(<Story />, fakeBlocks({ status: "loading" })));
    expect(screen.getByRole("img", { name: OPENING_HIDDEN })).toBeInTheDocument();
    rerender(inTheme(<Story />));
    expect(screen.getByText("“The bell rang once.”")).toBeInTheDocument();

    // Held in flight: the button says so and can't be pressed again.
    await user.click(screen.getByRole("button", { name: "Rejoin as Ana" }));
    expect(await screen.findByRole("button", { name: "Rejoining…" })).toBeDisabled();

    // The turn moved on: the message says the story changed, and the writer can try again.
    rejoining.finish(jsonResponse(409, { error: "stale_turn" }));
    expect(await screen.findByText(/The story just changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejoin as Ana" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Rejoin as Ana" }));
    expect(await screen.findByRole("button", { name: "Rejoining…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/^$/);
    rejoiningAgain.finish(noContentResponse());

    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "You left this story" })).not.toBeInTheDocument();
    expect(api.sent("rejoin")).toEqual([
      { url: "/api/stories/abc12/rejoin", body: "{}" },
      { url: "/api/stories/abc12/rejoin", body: "{}" },
    ]);

    // Another story the writer left, which is full.
    params["storyId"] = "def34";
    rerender(inTheme(<Story />));
    await user.click(await screen.findByRole("button", { name: "Rejoin as Ana" }));

    // An older Worker sent no opening author, so the opening stays hidden.
    expect(screen.getByRole("img", { name: OPENING_HIDDEN })).toBeInTheDocument();
    expect(
      await screen.findByText("This story is full (50 writers), so you can't rejoin it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejoin as Ana" })).toBeDisabled();
  });
});

type Route = "story" | "me" | "join" | "rejoin";
type Reply = Response | Promise<Response>;

/**
 * Stubs `fetch` for the calls the page makes. Each route answers its queued replies in order,
 * then a default: the joined writer's story, a user with no name, and an error for a join or
 * rejoin nobody queued.
 */
function stubApi() {
  const queued: { [route in Route]: Reply[] } = { story: [], me: [], join: [], rejoin: [] };
  const sent: { route: Route; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const route = routeOf(url);
    sent.push({ route, url, body: init?.body });

    return Promise.resolve(queued[route].shift() ?? defaultReply(route));
  });

  return {
    queue: (route: Route, ...replies: Reply[]) => {
      queued[route].push(...replies);
    },
    sent: (route: Route) =>
      sent.filter((request) => request.route === route).map(({ url, body }) => ({ url, body })),
    urls: (route: Route) =>
      sent.filter((request) => request.route === route).map((request) => request.url),
  };
}

function routeOf(url: string): Route {
  if (url === "/api/users/me") {
    return "me";
  }
  if (url.endsWith("/participants")) {
    return "join";
  }

  return url.endsWith("/rejoin") ? "rejoin" : "story";
}

function defaultReply(route: Route): Response {
  if (route === "join" || route === "rejoin") {
    throw new Error(`A ${route} nobody queued reached the server.`);
  }

  return route === "me" ? jsonResponse(200, { displayName: null }) : jsonResponse(200, view);
}

/** A request the test settles itself, so it can look at the screen while the request is in flight. */
function inFlight() {
  const { promise, resolve, reject } = Promise.withResolvers<Response>();

  return { response: promise, finish: resolve, fail: reject };
}
