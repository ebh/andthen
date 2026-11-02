// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ContributionView } from "../../shared/api";
import { StoryText } from "./StoryText";

const contributions: readonly ContributionView[] = [
  { id: "c1", authorId: "p1", authorName: "Ana", text: "A fox found a key.", createdAt: 1 },
  { id: "c2", authorId: "p2", authorName: "Ben", text: "It opened nothing.", createdAt: 2 },
];

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
          { id: "c1", authorId: "p1", authorName: "Ana", text: hostile, createdAt: 1 },
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
});
