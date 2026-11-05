// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InviteLink } from "./InviteLink";
import { renderPage } from "./testRender";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InviteLink", () => {
  it("shows the story address in a read-only field", () => {
    renderPage(<InviteLink url="https://andthen.page/abc12" />);

    const field = screen.getByLabelText("Invite link");
    expect(field).toHaveValue("https://andthen.page/abc12");
    expect(field).toHaveAttribute("readonly");
  });

  it("copies the address and says so", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderPage(<InviteLink url="https://andthen.page/abc12" />);

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith("https://andthen.page/abc12");
    expect(await screen.findByText("Link copied.")).toBeInTheDocument();
  });

  it("tells the writer to copy it themselves when the clipboard refuses", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.reject(new Error("denied")),
    );
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderPage(<InviteLink url="https://andthen.page/abc12" />);

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't copy.");
  });
});
