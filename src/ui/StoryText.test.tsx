// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hiddenPassageLabel } from "../client/blockMessages";
import type { PassageView } from "../shared/api";
import { StoryText } from "./StoryText";
import { fakeBlocks, inTheme, renderPage } from "./testRender";
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

// Ana (user p1) is the signed-in user.
function storyElement(passages: readonly PassageView[] = turns) {
  return <StoryText passages={passages} myUserId="p1" />;
}

type ChangeBlock = (action: "block" | "unblock", userId: string) => void;

const blockingBen = { blocked: [{ id: "b1", blockedUserId: "p2" }] };

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(firstAuthor(name));

  return screen.getByRole("menu");
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
  it("keeps authors behind a switch on a narrow screen and pins a turn highlight from the author's menu", async () => {
    const user = userEvent.setup();
    renderPage(storyElement());
    const toggle = screen.getByRole("switch", { name: "Show authors" });
    expect(toggle).not.toBeChecked();
    expect(authorNames()).toEqual([]);

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(authorNames()).toEqual(["Ana", "Ben", "Cat"]);

    // A tap's emulated hover and focus must not highlight, or opening the menu would show a false pin.
    await user.hover(firstAuthor("Ana"));
    expect(highlighted()).toEqual([]);

    await openMenu(user, "Ana");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));
    expect(highlighted()).toEqual(["A fox found a key.", "Or so it seemed."]);

    await openMenu(user, "Ana");
    expect(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" })).toBeChecked();
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));
    expect(highlighted()).toEqual([]);

    await openMenu(user, "Ana");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));
    expect(highlighted()).toHaveLength(2);
    await user.click(toggle);
    expect(authorNames()).toEqual([]);
    expect(highlighted()).toEqual([]);
  });

  it("lists authors beside each paragraph on a wide screen and highlights on hover or keyboard focus", async () => {
    setScreen({ wide: true, hover: true });
    const user = userEvent.setup();
    renderPage(storyElement());

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

  it("ignores hover and pointer focus on a wide screen that cannot hover, but still pins from the menu", async () => {
    setScreen({ wide: true, hover: false });
    const user = userEvent.setup();
    renderPage(storyElement());
    const ben = firstAuthor("Ben");

    await user.hover(ben);
    expect(highlighted()).toEqual([]);

    await user.tab();
    expect(firstAuthor("Ana")).toHaveFocus();
    expect(highlighted()).toEqual([]);

    await openMenu(user, "Ben");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));
    expect(highlighted()).toEqual(["It opened nothing."]);
  });

  it("joins turns into paragraphs and renders their text as plain text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)><b>bold</b>";
    renderPage(storyElement([...turns, turn("c5", "p1", "Ana", hostile, true)]));

    const paragraphs = story().querySelectorAll("p");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toHaveTextContent(
      "A fox found a key. It opened nothing. Or so it seemed.",
    );
    expect(paragraphs[1]).toHaveTextContent("Morning came.");
    expect(within(story()).getByText(hostile)).toBeInTheDocument();
    expect(story().querySelector("img, b")).toBeNull();
  });

  it("offers Block or Unblock on other authors only, calls the one picked, holds both while a change is out, and returns focus to the name on Escape", async () => {
    const change = vi.fn<ChangeBlock>();
    const user = userEvent.setup();
    setScreen({ wide: true, hover: true });
    const { rerender } = renderPage(storyElement(), fakeBlocks({ ...blockingBen, change }));

    await openMenu(user, "Ana");
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await openMenu(user, "Cat");
    await user.click(screen.getByRole("menuitem", { name: "Block Cat" }));
    expect(change).toHaveBeenLastCalledWith("block", "p3");

    await openMenu(user, "Ben");
    expect(screen.queryByRole("menuitem", { name: "Block Ben" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Unblock Ben" }));
    expect(change).toHaveBeenLastCalledWith("unblock", "p2");
    expect(change).toHaveBeenCalledTimes(2);

    rerender(inTheme(storyElement(), fakeBlocks({ change, working: "Blocking…" })));
    await openMenu(user, "Cat");
    expect(screen.getByRole("menuitem", { name: "Block Cat" })).toHaveAttribute("data-disabled");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(firstAuthor("Cat")).toHaveFocus();
    });
    expect(highlighted()).toEqual([]);
  });

  // Pins that a blocked author's passage reaches the page only as a stand-in, that the user can
  // show it by press or key, and that a changed block hides it again. The rules are unit tested
  // in blocks.test.ts and blockMessages.test.ts; without this the page would show blocked text.
  it("obscures a blocked author's passage until pressed, hides it again when the block changes, and keeps one notice row", async () => {
    const label = hiddenPassageLabel("Ben");
    const change = vi.fn<ChangeBlock>();
    const user = userEvent.setup();
    const { rerender } = renderPage(storyElement(), fakeBlocks({ ...blockingBen, change }));
    const progress = screen.getByRole("status");
    const failure = screen.getByRole("alert");
    const filler = screen.getByRole("button", { name: label }).querySelector("[aria-hidden]");
    expect(story().textContent).not.toContain("It opened nothing.");
    expect(story().textContent).toContain("A fox found a key.");
    expect(filler).toHaveAttribute("aria-hidden", "true");
    expect(filler).toHaveStyle({ filter: "blur(4px)" });
    expect(filler?.textContent).toHaveLength("It opened nothing.".length);
    expect(progress).toBeEmptyDOMElement();
    expect(failure).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: label }));
    expect(screen.getByText("It opened nothing.")).toHaveFocus();
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();

    // The same block after a reload keeps the passage shown; a new block hides it again.
    rerender(inTheme(storyElement(), fakeBlocks(blockingBen)));
    expect(screen.getByText("It opened nothing.")).toBeInTheDocument();
    rerender(inTheme(storyElement(), fakeBlocks({ blocked: [{ id: "b2", blockedUserId: "p2" }] })));
    expect(story().textContent).not.toContain("It opened nothing.");

    // A Space that is not prevented would also scroll the page; other keys do nothing.
    const standIn = screen.getByRole("button", { name: label });
    fireEvent.keyDown(standIn, { key: "a" });
    expect(screen.queryByText("It opened nothing.")).not.toBeInTheDocument();
    expect(fireEvent.keyDown(standIn, { key: " " })).toBe(false);
    expect(screen.getByText("It opened nothing.")).toBeInTheDocument();

    // The notice row keeps its two live regions, so a screen reader announces what arrives.
    rerender(
      inTheme(
        storyElement(),
        fakeBlocks({ blocked: [{ id: "b2", blockedUserId: "p2" }], error: "Couldn't block." }),
      ),
    );
    expect(screen.getByRole("status")).toBe(progress);
    expect(screen.getByRole("alert")).toBe(failure);
    expect(failure).toHaveTextContent("Couldn't block.");
  });
});
