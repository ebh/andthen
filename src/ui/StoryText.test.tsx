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

function highlighted(): string[] {
  return Array.from(story().querySelectorAll("mark")).map((mark) => mark.textContent);
}

describe("StoryText", () => {
  it("renders passage text as plain text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)><b>bold</b>";
    renderPage(<StoryText passages={[turn("c1", "p1", "Ana", hostile, true)]} />);

    expect(within(story()).getByText(hostile)).toBeInTheDocument();
    expect(story().querySelector("img, b")).toBeNull();
  });

  it("joins turns that continue a paragraph and starts a new one where asked", () => {
    renderPage(<StoryText passages={turns} />);

    expect(story().querySelectorAll("p")[0]).toHaveTextContent(
      "A fox found a key. It opened nothing. Or so it seemed.",
    );
    expect(story().querySelectorAll("p")[1]).toHaveTextContent("Morning came.");
  });

  describe("on a narrow screen", () => {
    it("hides the authors until the reader switches them on, and off again", async () => {
      const user = userEvent.setup();
      renderPage(<StoryText passages={turns} />);
      const toggle = screen.getByRole("switch", { name: "Show authors" });

      expect(toggle).not.toBeChecked();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();

      await user.click(toggle);
      expect(toggle).toBeChecked();
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Ana",
        "Ben",
        "Cat",
      ]);

      await user.click(toggle);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("pins an author's turns on press and releases them on the next press", async () => {
      const user = userEvent.setup();
      renderPage(<StoryText passages={turns} />);
      await user.click(screen.getByRole("switch", { name: "Show authors" }));
      const ana = screen.getByRole("button", { name: "Ana" });
      expect(ana).toHaveAttribute("aria-pressed", "false");

      await user.click(ana);
      expect(ana).toHaveAttribute("aria-pressed", "true");
      expect(highlighted()).toEqual(["A fox found a key.", "Or so it seemed."]);

      await user.click(ana);
      expect(ana).toHaveAttribute("aria-pressed", "false");
      expect(highlighted()).toEqual([]);
    });

    it("drops a pinned highlight when the authors are switched off", async () => {
      const user = userEvent.setup();
      renderPage(<StoryText passages={turns} />);
      const toggle = screen.getByRole("switch", { name: "Show authors" });
      await user.click(toggle);
      await user.click(screen.getByRole("button", { name: "Ana" }));

      await user.click(toggle);

      expect(highlighted()).toEqual([]);
    });

    it("does not highlight on a tap's hover or focus, so the second tap can release", async () => {
      const user = userEvent.setup();
      renderPage(<StoryText passages={turns} />);
      await user.click(screen.getByRole("switch", { name: "Show authors" }));

      await user.hover(screen.getByRole("button", { name: "Ana" }));

      expect(highlighted()).toEqual([]);
    });
  });

  describe("on a wide screen", () => {
    it("lists the authors beside each paragraph with no toggle", () => {
      setScreen({ wide: true, hover: true });
      renderPage(<StoryText passages={turns} />);

      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Ana",
        "Ben",
        "Cat",
      ]);
    });

    it("highlights an author's turns in their paragraph only while a mouse is over the name", async () => {
      setScreen({ wide: true, hover: true });
      const user = userEvent.setup();
      renderPage(<StoryText passages={turns} />);
      const ben = screen.getAllByRole("button", { name: "Ben" })[0];
      if (ben === undefined) {
        throw new Error("No author button for Ben");
      }

      await user.hover(ben);
      expect(highlighted()).toEqual(["It opened nothing."]);

      await user.unhover(ben);
      expect(highlighted()).toEqual([]);
    });

    it("highlights on keyboard focus and clears it on blur", async () => {
      setScreen({ wide: true, hover: true });
      focusIsFromKeyboard(true);
      const user = userEvent.setup();
      renderPage(<StoryText passages={turns} />);

      await user.tab();
      expect(screen.getAllByRole("button", { name: "Ana" })[0]).toHaveFocus();
      expect(highlighted()).toEqual(["A fox found a key.", "Or so it seemed."]);

      await user.tab();
      expect(highlighted()).toEqual(["It opened nothing."]);
    });

    it("ignores hover on a device that cannot hover", async () => {
      setScreen({ wide: true, hover: false });
      const user = userEvent.setup();
      renderPage(<StoryText passages={turns} />);

      await user.hover(screen.getAllByRole("button", { name: "Ben" })[0] ?? document.body);

      expect(highlighted()).toEqual([]);
    });
  });
});
