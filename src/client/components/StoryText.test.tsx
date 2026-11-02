// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ContributionView } from "../../shared/api";
import { StoryText } from "./StoryText";

const contributions: readonly ContributionView[] = [
  {
    id: "c1",
    authorId: "p1",
    authorName: "Ana",
    text: "A fox found a key.",
    startsParagraph: true,
    createdAt: 1,
  },
  {
    id: "c2",
    authorId: "p2",
    authorName: "Ben",
    text: "It opened nothing.",
    startsParagraph: true,
    createdAt: 2,
  },
];

function paragraphs(): HTMLElement[] {
  const story = screen.getByRole("region", { name: "The story so far" });
  return within(story).getAllByRole("paragraph");
}

describe("StoryText", () => {
  it("shows each passage in order with its author kept in the document", () => {
    render(<StoryText contributions={contributions} />);

    const story = screen.getByRole("region", { name: "The story so far" });
    expect(story).toHaveTextContent(/A fox found a key\..*Ana.*It opened nothing\..*Ben/);
  });

  it("renders passage text as plain text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)><b>bold</b>";
    render(
      <StoryText
        contributions={[
          {
            id: "c1",
            authorId: "p1",
            authorName: "Ana",
            text: hostile,
            startsParagraph: true,
            createdAt: 1,
          },
        ]}
      />,
    );

    const story = screen.getByRole("region", { name: "The story so far" });
    expect(within(story).getByText(hostile)).toBeInTheDocument();
    expect(story.querySelector("img, b")).toBeNull();
  });

  it("starts with authors off for narrow screens and lets the reader switch them on and off", async () => {
    const user = userEvent.setup();
    render(<StoryText contributions={contributions} />);

    const toggle = screen.getByRole("checkbox", { name: "Show authors" });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  describe("paragraphs and authors", () => {
    const turns: ContributionView[] = [
      {
        id: "c1",
        authorId: "p1",
        authorName: "Ana",
        text: "A fox found a key.",
        startsParagraph: true,
        createdAt: 1,
      },
      {
        id: "c2",
        authorId: "p2",
        authorName: "Ben",
        text: "It opened nothing.",
        startsParagraph: false,
        createdAt: 2,
      },
      {
        id: "c3",
        authorId: "p1",
        authorName: "Ana",
        text: "Or so it seemed.",
        startsParagraph: false,
        createdAt: 3,
      },
      {
        id: "c4",
        authorId: "p3",
        authorName: "Cat",
        text: "Morning came.",
        startsParagraph: true,
        createdAt: 4,
      },
    ];

    it("joins turns that continue a paragraph and starts a new one where asked", () => {
      render(<StoryText contributions={turns} />);

      expect(paragraphs().map((p) => p.textContent)).toEqual([
        "A fox found a key. It opened nothing. Or so it seemed.",
        "Morning came.",
      ]);
    });

    it("lists each author of a paragraph once", () => {
      render(<StoryText contributions={turns} />);

      expect(screen.getAllByRole("button", { name: "Ana" })).toHaveLength(1);
      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
        "Ana",
        "Ben",
        "Cat",
      ]);
    });

    it("highlights every turn of an author in their paragraph while hovered with a mouse", async () => {
      const user = userEvent.setup();
      render(<StoryText contributions={turns} />);

      await user.hover(screen.getByRole("button", { name: "Ana" }));
      expect(Array.from(document.querySelectorAll("mark")).map((m) => m.textContent)).toEqual([
        "A fox found a key.",
        "Or so it seemed.",
      ]);

      await user.unhover(screen.getByRole("button", { name: "Ana" }));
      expect(document.querySelector("mark")).toBeNull();
    });

    it("pins the highlight on click and releases it on a second click", async () => {
      const user = userEvent.setup();
      render(<StoryText contributions={turns} />);
      const ben = screen.getByRole("button", { name: "Ben" });

      await user.click(ben);
      expect(ben).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelector("mark")).toHaveTextContent("It opened nothing.");

      await user.click(ben);
      await user.unhover(ben);
      expect(ben).toHaveAttribute("aria-pressed", "false");
      expect(document.querySelector("mark")).toBeNull();
    });

    it("highlights on keyboard focus", async () => {
      const user = userEvent.setup();
      render(<StoryText contributions={turns} />);

      await user.tab(); // the "Show authors" toggle
      await user.tab();

      expect(screen.getByRole("button", { name: "Ana" })).toHaveFocus();
      expect(document.querySelectorAll("mark")).toHaveLength(2);
    });

    it("drops a pinned highlight when the authors are switched off", async () => {
      const user = userEvent.setup();
      render(<StoryText contributions={turns} />);

      await user.click(screen.getByRole("button", { name: "Ana" }));
      await user.click(screen.getByRole("checkbox", { name: "Show authors" }));

      expect(document.querySelector("mark")).toBeNull();
    });
  });
});
