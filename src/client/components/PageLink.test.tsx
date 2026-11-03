// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { PageLink } from "./PageLink";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("PageLink", () => {
  it("links to the path and moves there without leaving the page", async () => {
    render(<PageLink to="/abc12">Open</PageLink>);
    const link = screen.getByRole("link", { name: "Open" });

    await userEvent.setup().click(link);

    expect(link).toHaveAttribute("href", "/abc12");
    expect(window.location.pathname).toBe("/abc12");
  });

  it.each(["{Control>}", "{Meta>}", "{Shift>}", "{Alt>}"])(
    "leaves a click with %s to the browser",
    async (modifier) => {
      render(<PageLink to="/abc12">Open</PageLink>);
      // jsdom can't follow a link, so stop it here, after the page link has had its say.
      let leftToBrowser = false;
      const stopNavigation = (event: Event): void => {
        leftToBrowser = !event.defaultPrevented;
        event.preventDefault();
      };
      document.addEventListener("click", stopNavigation);
      const user = userEvent.setup();

      await user.keyboard(modifier);
      await user.click(screen.getByRole("link", { name: "Open" }));
      document.removeEventListener("click", stopNavigation);

      expect(leftToBrowser).toBe(true);
      expect(window.location.pathname).toBe("/");
    },
  );
});
