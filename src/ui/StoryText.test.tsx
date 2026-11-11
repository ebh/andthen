// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PassageView } from "../shared/api";
import { StoryText } from "./StoryText";
import { renderPage } from "./testRender";
import { setScreen } from "./testScreen";

// jsdom treats every focus as keyboard focus; a test says which kind it means.
function focusIsFromKeyboard(fromKeyboard: boolean): void {
  // The original is called back with the element it was spied on, via `call`.
  // oxlint-disable-next-line typescript/unbound-method
  const matches = Element.prototype.matches;
  vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
    this: HTMLElement,
    selector,
  ) {
    return selector === ":focus-visible" ? fromKeyboard : matches.call(this, selector);
  });
}

beforeEach(() => {
  focusIsFromKeyboard(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const turns: PassageView[] = [
  turn("c1", "p1", "Ana", "A fox found a key.", true),
  turn("c2", "p2", "Ben", "It opened nothing.", false),
  turn("c3", "p1", "Ana", "Or so it seemed.", false),
  turn("c4", "p3", "Cat", "Morning came.", true),
];

function turn(
  id: string,
  authorId: string,
  authorName: string,
  text: string,
  startsParagraph: boolean,
): PassageView {
  return { id, authorId, authorName, text, startsParagraph, createdAt: 1 };
}

function story(): HTMLElement {
  return screen.getByRole("region", { name: "The story so far" });
}

function highlighted(): (string | null)[] {
  return Array.from(story().querySelectorAll("mark")).map((mark) => mark.textContent);
}

function authorNames(): (string | null)[] {
  return screen.queryAllByRole("button").map((button) => button.textContent);
}

// Each paragraph lists its authors, so a name can appear more than once; the first is enough.
function firstAuthor(name: string): HTMLElement {
  const [button] = screen.getAllByRole("button", { name });
  if (button === undefined) {
    throw new Error(`No author button for ${name}`);
  }

  return button;
}

describe("StoryText", () => {
  it("keeps authors behind a switch on a narrow screen and pins a turn highlight on press", async () => {
    const user = userEvent.setup();
    renderPage(<StoryText passages={turns} />);
    const toggle = screen.getByRole("switch", { name: "Show authors" });
    expect(toggle).not.toBeChecked();
    expect(authorNames()).toEqual([]);

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(authorNames()).toEqual(["Ana", "Ben", "Cat"]);
    const ana = screen.getByRole("button", { name: "Ana" });
    expect(ana).toHaveAttribute("aria-pressed", "false");

    // A tap's emulated hover and focus must not highlight, or the second tap could not release.
    await user.hover(ana);
    expect(highlighted()).toEqual([]);

    await user.click(ana);
    expect(ana).toHaveAttribute("aria-pressed", "true");
    expect(highlighted()).toEqual(["A fox found a key.", "Or so it seemed."]);

    await user.click(ana);
    expect(ana).toHaveAttribute("aria-pressed", "false");
    expect(highlighted()).toEqual([]);

    await user.click(ana);
    expect(highlighted()).toHaveLength(2);
    await user.click(toggle);
    expect(authorNames()).toEqual([]);
    expect(highlighted()).toEqual([]);

    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Ana" })).toHaveAttribute("aria-pressed", "false");
  });

  it("lists authors beside each paragraph on a wide screen and highlights on hover or keyboard focus", async () => {
    setScreen({ wide: true, hover: true });
    const user = userEvent.setup();
    renderPage(<StoryText passages={turns} />);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(authorNames()).toEqual(["Ana", "Ben", "Cat"]);

    const ben = firstAuthor("Ben");
    await user.hover(ben);
    expect(highlighted()).toEqual(["It opened nothing."]);
    await user.unhover(ben);
    expect(highlighted()).toEqual([]);

    focusIsFromKeyboard(true);
    await user.tab();
    expect(firstAuthor("Ana")).toHaveFocus();
    expect(highlighted()).toEqual(["A fox found a key.", "Or so it seemed."]);

    await user.tab();
    expect(highlighted()).toEqual(["It opened nothing."]);
    await user.tab();
    expect(highlighted()).toEqual(["Morning came."]);
    await user.tab();
    expect(highlighted()).toEqual([]);
  });

  it("ignores hover and pointer focus on a wide screen that cannot hover, but still pins on press", async () => {
    setScreen({ wide: true, hover: false });
    const user = userEvent.setup();
    renderPage(<StoryText passages={turns} />);
    const ben = firstAuthor("Ben");

    await user.hover(ben);
    expect(highlighted()).toEqual([]);

    await user.tab();
    expect(firstAuthor("Ana")).toHaveFocus();
    expect(highlighted()).toEqual([]);

    await user.click(ben);
    expect(ben).toHaveAttribute("aria-pressed", "true");
    expect(highlighted()).toEqual(["It opened nothing."]);
  });

  it("joins turns into paragraphs and renders their text as plain text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)><b>bold</b>";
    renderPage(<StoryText passages={[...turns, turn("c5", "p1", "Ana", hostile, true)]} />);

    const paragraphs = story().querySelectorAll("p");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toHaveTextContent(
      "A fox found a key. It opened nothing. Or so it seemed.",
    );
    expect(paragraphs[1]).toHaveTextContent("Morning came.");
    expect(within(story()).getByText(hostile)).toBeInTheDocument();
    expect(story().querySelector("img, b")).toBeNull();
  });
});
