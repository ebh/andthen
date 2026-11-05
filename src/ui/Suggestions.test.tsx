// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../client/testFixtures";
import { SuggestButton, SuggestionList, useSuggestions } from "./Suggestions";
import { renderPage } from "./testRender";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface SuggestionsProps {
  storyId: string;
  onUse: (text: string) => void;
  onTurnLost: () => void;
}

function Suggestions({ storyId, onUse, onTurnLost }: SuggestionsProps) {
  const control = useSuggestions(storyId, onTurnLost);
  return (
    <>
      <SuggestButton control={control} />
      <SuggestionList control={control} onUse={onUse} />
    </>
  );
}

const ASK = { name: "Suggest continuations" };

describe("Suggestions", () => {
  it("asks nothing until the button is clicked", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderPage(
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
    const { container } = renderPage(
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
    renderPage(<Suggestions storyId="abc12" onUse={onUse} onTurnLost={vi.fn<() => void>()} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", ASK));
    await user.click(await screen.findByRole("button", { name: "Two." }));

    expect(onUse).toHaveBeenCalledWith("Two.");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("disables the button while loading", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    renderPage(
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
      renderPage(
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

  it("tells the page the turn is lost on a 403 not_your_turn", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse(403, { error: "not_your_turn" })));
    const onTurnLost = vi.fn<() => void>();
    renderPage(
      <Suggestions
        storyId="abc12"
        onUse={vi.fn<(text: string) => void>()}
        onTurnLost={onTurnLost}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", ASK));

    expect(await screen.findByText("It's no longer your turn.")).toBeInTheDocument();
    expect(onTurnLost).toHaveBeenCalledOnce();
  });
});
