// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PageLink } from "./PageLink";

describe("PageLink", () => {
  it("links to the path and moves there without leaving the page", async () => {
    render(<PageLink to="/abc12">Open</PageLink>);
    const link = screen.getByRole("link", { name: "Open" });

    await userEvent.setup().click(link);

    expect(link).toHaveAttribute("href", "/abc12");
    expect(window.location.pathname).toBe("/abc12");
  });
});
