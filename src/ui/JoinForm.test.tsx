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

/** Stubs `fetch`: `GET /api/users/me` answers `me`, any other request answers `reply`. */
function stubFetch(me: Response, reply?: Response) {
  const fetchMock = vi.fn<typeof fetch>((input) =>
    Promise.resolve(
      input === "/api/users/me" ? me.clone() : (reply?.clone() ?? jsonResponse(500, {})),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

const noName = () => jsonResponse(200, { displayName: null });

function joinCalls(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([input]) => input !== "/api/users/me");
}

async function submitName(name: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Your name"), name);
  await user.click(screen.getByRole("button", { name: "Join" }));
}

describe("JoinForm", () => {
  it("waits for the user's name, then asks for one and does not call the server for an empty one", async () => {
    const fetchMock = stubFetch(noName());
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    expect(screen.queryByText(/Pick a name/)).not.toBeInTheDocument();

    await screen.findByLabelText("Your name");
    expect(screen.getByText(/Pick a name/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Join" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    expect(joinCalls(fetchMock)).toEqual([]);
  });

  it("joins with the trimmed name and reports success", async () => {
    const fetchMock = stubFetch(noName(), jsonResponse(201, { participantId: "p1" }));
    const onJoined = vi.fn<() => void>();
    renderPage(<JoinForm storyId="abc12" onJoined={onJoined} />);

    await submitName("  Sam ");

    await waitFor(() => {
      expect(onJoined).toHaveBeenCalledOnce();
    });
    expect(joinCalls(fetchMock)).toEqual([
      [
        "/api/stories/abc12/participants",
        expect.objectContaining({ body: JSON.stringify({ displayName: "Sam" }) }),
      ],
    ]);
  });

  it("shows no name field to a user who has a name, and joins without sending one", async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, { displayName: "Ana" }),
      jsonResponse(201, { participantId: "p1" }),
    );
    const onJoined = vi.fn<() => void>();
    renderPage(<JoinForm storyId="abc12" onJoined={onJoined} />);

    const join = screen.getByRole("button", { name: "Join" });
    await waitFor(() => {
      expect(join).toBeEnabled();
    });
    await userEvent.setup().click(join);

    await waitFor(() => {
      expect(onJoined).toHaveBeenCalledOnce();
    });
    expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
    expect(joinCalls(fetchMock)).toEqual([
      ["/api/stories/abc12/participants", expect.objectContaining({ body: "{}" })],
    ]);
  });

  it("offers a retry when the name can't be checked, and holds the join back", async () => {
    const fetchMock = stubFetch(jsonResponse(500, { error: "internal_error" }));
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    expect(await screen.findByText("Couldn't check your name.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();

    fetchMock.mockImplementation(() => Promise.resolve(noName()));
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
  });

  it("treats a browser that already joined as joined", async () => {
    stubFetch(noName(), jsonResponse(409, { error: "already_joined" }));
    const onJoined = vi.fn<() => void>();
    renderPage(<JoinForm storyId="abc12" onJoined={onJoined} />);

    await submitName("Sam");

    await waitFor(() => {
      expect(onJoined).toHaveBeenCalledOnce();
    });
  });

  it("explains a taken name, suggests signing in, and lets the user try another", async () => {
    stubFetch(noName(), jsonResponse(409, { error: "name_taken" }));
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    await submitName("Sam");

    expect(await screen.findByRole("alert")).toHaveTextContent("sign in");
    expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
  });

  // The name can change after the form loaded it, by sign-in or sign-out in another tab. Without
  // the reload, a user who lost their name would have no field and could never join.
  it("reloads the name when the server says the form's view of it is out of date", async () => {
    let me = jsonResponse(200, { displayName: "Ana" });
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0]) =>
      Promise.resolve(
        input === "/api/users/me"
          ? me.clone()
          : jsonResponse(400, { error: "invalid_display_name" }),
      ),
    );
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);
    const join = screen.getByRole("button", { name: "Join" });
    await waitFor(() => {
      expect(join).toBeEnabled();
    });
    me = noName();

    await userEvent.setup().click(join);

    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Check your name and try again.");
  });

  it("shows a full story message and offers no retry", async () => {
    stubFetch(noName(), jsonResponse(409, { error: "story_full" }));
    renderPage(<JoinForm storyId="abc12" onJoined={vi.fn<() => void>()} />);

    await submitName("Sam");

    expect(await screen.findByRole("alert")).toHaveTextContent("This story is full (50 writers).");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });
});
