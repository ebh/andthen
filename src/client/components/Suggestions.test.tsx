// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../testFixtures";
import { Suggestions } from "./Suggestions";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ASK = { name: "Suggest continuations" };

describe("Suggestions", () => {
  it("asks nothing until the button is clicked", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <Suggestions
        storyId="abc12"
        onUse={vi.fn<(text: string) => void>()}
        onTurnLost={vi.fn<() => void>()}
      />,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders suggestions as plain text, never HTML", async () => {
    const hostile = '<img src=x onerror="alert(1)"> <b>bold</b>';
    vi.stubGlobal("fetch", () =>
      Promise.resolve(jsonResponse(200, { suggestions: [hostile, "Two.", "Three."] })),
    );
    const { container } = render(
      <Suggestions
        storyId="abc12"
        onUse={vi.fn<(text: string) => void>()}
        onTurnLost={vi.fn<() => void>()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", ASK));

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("img, b")).toBeNull();
  });

  it("hands the chosen text to the composer without submitting anything", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse(200, { suggestions: ["One.", "Two.", "Three."] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onUse = vi.fn<(text: string) => void>();
    render(<Suggestions storyId="abc12" onUse={onUse} onTurnLost={vi.fn<() => void>()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", ASK));
    await user.click(await screen.findByRole("button", { name: "Two." }));

    expect(onUse).toHaveBeenCalledWith("Two.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("disables the button while loading", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    render(
      <Suggestions
        storyId="abc12"
        onUse={vi.fn<(text: string) => void>()}
        onTurnLost={vi.fn<() => void>()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", ASK));

    expect(screen.getByRole("button", { name: "Thinking…" })).toBeDisabled();
  });

  it.each([
    [429, "ai_rate_limited", "used your suggestions for this hour"],
    [503, "ai_unavailable", "aren't available right now"],
  ])(
    "shows a friendly message for %i %s and keeps the button usable",
    async (status, code, text) => {
      vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(status, { error: code })));
      render(
        <Suggestions
          storyId="abc12"
          onUse={vi.fn<(text: string) => void>()}
          onTurnLost={vi.fn<() => void>()}
        />,
      );

      await userEvent.setup().click(screen.getByRole("button", ASK));

      expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
      expect(screen.getByRole("button", ASK)).toBeEnabled();
    },
  );
});
