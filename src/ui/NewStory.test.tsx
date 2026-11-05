// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../client/testFixtures";
import { NewStory } from "./NewStory";
import { push } from "./routerStub";
import { renderPage } from "./testRender";

vi.mock("expo-router", async () => (await import("./routerStub")).routerStub);

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
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
  it("has the wordmark as its level-1 heading, then the pitch and the form title", () => {
    renderPage(<NewStory />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("And then…");
    expect(screen.getByRole("heading", { name: /write it together/i })).toBeInTheDocument();
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a name that is too long before calling the server", async () => {
    const fetchMock = stubFetch();
    renderPage(<NewStory />);

    const user = await fillIn("n".repeat(41), "It began.");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Names can be at most 40 characters.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the story with the trimmed name and passage, then opens it", async () => {
    const fetchMock = stubFetch(jsonResponse(201, { storyId: "abc12" }));
    renderPage(<NewStory />);

    const user = await fillIn("  Ada ", "  It began. ");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/abc12");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/stories");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ displayName: "Ada", opening: "It began." }),
    );
  });

  it("submits from the keyboard", async () => {
    stubFetch(jsonResponse(201, { storyId: "abc12" }));
    renderPage(<NewStory />);

    const user = await fillIn("Ada", "It began.");
    await user.type(screen.getByLabelText("Your name"), "{Enter}");

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/abc12");
    });
  });

  it("says the server is unreachable and keeps what was typed", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")));
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
    stubFetch(jsonResponse(500, { error: "internal_error" }));
    renderPage(<NewStory />);

    const user = await fillIn("Ada", "It began.");
    await user.click(screen.getByRole("button", { name: "Start the story" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
