// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ME, OTHER, jsonResponse, noContentResponse, storyView } from "../testFixtures";
import { Story } from "./Story";

// The board opens a real WebSocket; its logic is covered in live.test.ts.
vi.mock("../useStoryLive", () => ({ useStoryLive: vi.fn<() => void>() }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Story", () => {
  it("offers a writer who left their old name, then shows the story once they rejoin", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(403, { error: "left_story", displayName: "Ana", opening: "Once." }),
      )
      .mockResolvedValueOnce(noContentResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          storyView({ participants: [OTHER, ME], holderId: OTHER, lastWriterId: ME }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<Story storyId="abc12" />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Rejoin as Ana" }));

    expect(await screen.findByRole("region", { name: "Turn" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/stories/abc12",
      "/api/stories/abc12/rejoin",
      "/api/stories/abc12",
    ]);
  });
});
