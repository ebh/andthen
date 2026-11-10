// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function openMenu(user: ReturnType<typeof userEvent.setup>, author: string) {
  await user.click(screen.getAllByRole("button", { name: author })[0] ?? document.body);

  return screen.getByRole("menu");
}

const blockingBen = { blocked: [{ id: "b1", blockedUserId: "p2" }] };

function story(): HTMLElement {
  return screen.getByRole("region", { name: "The story so far" });
}

function highlighted(): string[] {
  return Array.from(story().querySelectorAll("mark")).map((mark) => mark.textContent);
}

describe("StoryText", () => {
  it("renders passage text as plain text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)><b>bold</b>";
    renderPage(storyElement([turn("c1", "p1", "Ana", hostile, true)]));

    expect(within(story()).getByText(hostile)).toBeInTheDocument();
    expect(story().querySelector("img, b")).toBeNull();
  });

  it("joins turns that continue a paragraph and starts a new one where asked", () => {
    renderPage(storyElement());

    expect(story().querySelectorAll("p")[0]).toHaveTextContent(
      "A fox found a key. It opened nothing. Or so it seemed.",
    );
    expect(story().querySelectorAll("p")[1]).toHaveTextContent("Morning came.");
  });

  describe("on a narrow screen", () => {
    it("hides the authors until the user switches them on, and off again", async () => {
      const user = userEvent.setup();
      renderPage(storyElement());
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

    it("lists each author of a paragraph once", async () => {
      renderPage(storyElement());
      await userEvent.setup().click(screen.getByRole("switch", { name: "Show authors" }));

      expect(screen.getAllByRole("button", { name: "Ana" })).toHaveLength(1);
    });

    it("pins an author's turns from the menu and releases them on the next choice", async () => {
      const user = userEvent.setup();
      renderPage(storyElement());
      await user.click(screen.getByRole("switch", { name: "Show authors" }));

      await openMenu(user, "Ana");
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));
      expect(highlighted()).toEqual(["A fox found a key.", "Or so it seemed."]);

      await openMenu(user, "Ana");
      expect(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" })).toBeChecked();
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));
      expect(highlighted()).toEqual([]);
    });

    it("moves the pin to another author's turns", async () => {
      const user = userEvent.setup();
      renderPage(storyElement());
      await user.click(screen.getByRole("switch", { name: "Show authors" }));

      await openMenu(user, "Ana");
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));
      await openMenu(user, "Ben");
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));

      expect(highlighted()).toEqual(["It opened nothing."]);
    });

    it("drops a pinned highlight when the authors are switched off", async () => {
      const user = userEvent.setup();
      renderPage(storyElement());
      const toggle = screen.getByRole("switch", { name: "Show authors" });
      await user.click(toggle);
      await openMenu(user, "Ana");
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Highlight passages" }));

      await user.click(toggle);

      expect(highlighted()).toEqual([]);
    });

    it("does not highlight on a tap's hover or focus, so opening the menu shows the pin as it is", async () => {
      const user = userEvent.setup();
      renderPage(storyElement());
      await user.click(screen.getByRole("switch", { name: "Show authors" }));

      await user.hover(screen.getByRole("button", { name: "Ana" }));

      expect(highlighted()).toEqual([]);
    });

    it("offers Block on another author but nothing on the user's own name, and blocks the user they pick", async () => {
      const block = vi.fn<(user: { id: string; name: string }) => void>();
      const user = userEvent.setup();
      renderPage(storyElement(), fakeBlocks({ block }));
      await user.click(screen.getByRole("switch", { name: "Show authors" }));

      await openMenu(user, "Ana");
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
      await user.keyboard("{Escape}");

      await openMenu(user, "Ben");
      await user.click(screen.getByRole("menuitem", { name: "Block Ben" }));

      expect(block).toHaveBeenCalledExactlyOnceWith({ id: "p2", name: "Ben" });
    });

    it("offers Unblock on a blocked author and unblocks the user they pick", async () => {
      const unblock = vi.fn<(user: { id: string; name: string }) => void>();
      const block = vi.fn<(user: { id: string; name: string }) => void>();
      const user = userEvent.setup();
      renderPage(storyElement(), fakeBlocks({ ...blockingBen, unblock, block }));
      await user.click(screen.getByRole("switch", { name: "Show authors" }));

      await openMenu(user, "Ben");
      expect(screen.queryByRole("menuitem", { name: "Block Ben" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("menuitem", { name: "Unblock Ben" }));

      expect(unblock).toHaveBeenCalledExactlyOnceWith({ id: "p2", name: "Ben" });
      expect(block).not.toHaveBeenCalled();
    });

    it("holds every Block and Unblock while a change is out", async () => {
      const block = vi.fn<(user: { id: string; name: string }) => void>();
      const user = userEvent.setup();
      renderPage(storyElement(), fakeBlocks({ block, working: "Blocking…" }));
      await user.click(screen.getByRole("switch", { name: "Show authors" }));

      await openMenu(user, "Cat");

      expect(screen.getByRole("menuitem", { name: "Block Cat" })).toHaveAttribute("data-disabled");
    });

    it("hands focus back to the author's name after Escape, with no highlight left on", async () => {
      const user = userEvent.setup();
      renderPage(storyElement());
      await user.click(screen.getByRole("switch", { name: "Show authors" }));
      const ben = screen.getByRole("button", { name: "Ben" });

      await openMenu(user, "Ben");
      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(ben).toHaveFocus();
      });
      expect(highlighted()).toEqual([]);
    });
  });

  describe("the blocks notice", () => {
    it("holds one row so the story never moves, keeps the same two live regions for its whole life, and shows progress, a failure and a failed load", () => {
      const { rerender } = renderPage(storyElement());
      const progress = screen.getByRole("status");
      const failure = screen.getByRole("alert");
      expect(progress).toBeEmptyDOMElement();
      expect(failure).toBeEmptyDOMElement();

      rerender(inTheme(storyElement(), fakeBlocks({ working: "Blocking…" })));
      expect(progress).toHaveTextContent("Blocking…");
      expect(failure).toBeEmptyDOMElement();

      rerender(inTheme(storyElement(), fakeBlocks({ error: "Couldn't block. Reload the page." })));
      expect(progress).toBeEmptyDOMElement();
      expect(failure).toHaveTextContent("Couldn't block. Reload the page.");

      rerender(inTheme(storyElement(), fakeBlocks({ status: "failed" })));
      expect(failure).toHaveTextContent("Couldn't load blocked users. Try again.");
    });
  });

  describe("a blocked author's passage", () => {
    const label = "Passage by Ben, hidden because you blocked them";

    it("holds no real text until the user presses it, and showing it does not unblock", async () => {
      const unblock = vi.fn<(user: { id: string; name: string }) => void>();
      const user = userEvent.setup();
      renderPage(storyElement(), fakeBlocks({ ...blockingBen, unblock }));

      expect(screen.queryByText("It opened nothing.")).not.toBeInTheDocument();
      expect(story().textContent).not.toContain("It opened nothing.");
      expect(story().textContent).toContain("A fox found a key.");

      await user.click(screen.getByRole("button", { name: label }));

      expect(screen.getByText("It opened nothing.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
      expect(unblock).not.toHaveBeenCalled();
    });

    it("draws a blurred filler that screen readers skip, and moves focus to the text once shown", async () => {
      const user = userEvent.setup();
      renderPage(storyElement(), fakeBlocks(blockingBen));
      const filler = screen.getByRole("button", { name: label }).querySelector("[aria-hidden]");

      expect(filler).toHaveAttribute("aria-hidden", "true");
      expect(filler).toHaveStyle({ filter: "blur(4px)" });
      expect(filler?.textContent).toHaveLength("It opened nothing.".length);

      await user.click(screen.getByRole("button", { name: label }));

      expect(screen.getByText("It opened nothing.")).toHaveFocus();
    });

    it.each([["Enter"], [" "]])("shows the real text on %j from the keyboard", (key) => {
      renderPage(storyElement(), fakeBlocks(blockingBen));

      const notPrevented = fireEvent.keyDown(screen.getByRole("button", { name: label }), { key });

      // A Space that is not prevented would also scroll the page.
      expect(notPrevented).toBe(false);
      expect(screen.getByText("It opened nothing.")).toBeInTheDocument();
    });

    it("ignores other keys", () => {
      renderPage(storyElement(), fakeBlocks(blockingBen));

      fireEvent.keyDown(screen.getByRole("button", { name: label }), { key: "a" });

      expect(screen.queryByText("It opened nothing.")).not.toBeInTheDocument();
    });

    it("stays shown while the same block stands, and hides again when the block changes", async () => {
      const user = userEvent.setup();
      const { rerender } = renderPage(storyElement(), fakeBlocks(blockingBen));
      await user.click(screen.getByRole("button", { name: label }));
      expect(screen.getByText("It opened nothing.")).toBeInTheDocument();

      rerender(inTheme(storyElement(), fakeBlocks(blockingBen)));
      expect(screen.getByText("It opened nothing.")).toBeInTheDocument();

      rerender(inTheme(storyElement(), fakeBlocks()));
      expect(story().textContent).toContain("A fox found a key. It opened nothing.");

      rerender(
        inTheme(storyElement(), fakeBlocks({ blocked: [{ id: "b2", blockedUserId: "p2" }] })),
      );
      expect(story().textContent).not.toContain("It opened nothing.");
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });
  });

  describe("until the user's blocks have loaded", () => {
    it.each(["loading", "failed"] as const)(
      "obscures everyone else's passages but not the user's own when %s, and reveals them one at a time",
      async (status) => {
        const user = userEvent.setup();
        renderPage(storyElement(), fakeBlocks({ status }));

        expect(story().textContent).not.toContain("It opened nothing.");
        expect(story().textContent).not.toContain("Morning came.");
        expect(story().textContent).toContain("A fox found a key. ");
        expect(story().textContent).toContain("Or so it seemed.");

        await user.click(
          screen.getByRole("button", {
            name: "Passage by Cat, hidden because you blocked them",
          }),
        );

        expect(screen.getByText("Morning came.")).toBeInTheDocument();
        expect(story().textContent).not.toContain("It opened nothing.");
      },
    );

    it("hides a passage revealed while loading once the list arrives and blocks that author", async () => {
      const user = userEvent.setup();
      const { rerender } = renderPage(storyElement(), fakeBlocks({ status: "loading" }));
      await user.click(
        screen.getByRole("button", { name: "Passage by Ben, hidden because you blocked them" }),
      );
      expect(screen.getByText("It opened nothing.")).toBeInTheDocument();

      rerender(inTheme(storyElement(), fakeBlocks(blockingBen)));

      expect(story().textContent).not.toContain("It opened nothing.");
    });
  });

  describe("on a wide screen", () => {
    it("lists the authors beside each paragraph with no toggle", () => {
      setScreen({ wide: true, hover: true });
      renderPage(storyElement());

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
      renderPage(storyElement());
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
      renderPage(storyElement());

      await user.tab();
      expect(screen.getAllByRole("button", { name: "Ana" })[0]).toHaveFocus();
      expect(highlighted()).toEqual(["A fox found a key.", "Or so it seemed."]);

      await user.tab();
      expect(highlighted()).toEqual(["It opened nothing."]);
    });

    it("ignores hover on a device that cannot hover", async () => {
      setScreen({ wide: true, hover: false });
      const user = userEvent.setup();
      renderPage(storyElement());

      await user.hover(screen.getAllByRole("button", { name: "Ben" })[0] ?? document.body);

      expect(highlighted()).toEqual([]);
    });
  });
});
