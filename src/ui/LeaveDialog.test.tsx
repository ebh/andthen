// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TurnAfterLeaving } from "../client/storyRules";
import { LeaveDialog } from "./LeaveDialog";
import { renderPage } from "./testRender";

function renderDialog(
  overrides: Partial<{
    turnAfterLeaving: TurnAfterLeaving;
    leaving: boolean;
    error: string | null;
  }> = {},
) {
  const onOpen = vi.fn<() => void>();
  const onConfirm = vi.fn<() => void>();
  renderPage(
    <LeaveDialog
      turnAfterLeaving={{ type: "unchanged" }}
      leaving={false}
      error={null}
      onOpen={onOpen}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );

  return { onOpen, onConfirm };
}

// Tamagui's `DialogClose` hard-codes its accessible name to "Dialog Close", so the buttons inside
// the dialog are found by visible text.
async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Leave story" }));

  return { user, dialog: await screen.findByRole("alertdialog", { name: "Leave this story?" }) };
}

describe("LeaveDialog", () => {
  it("is closed until the Leave story button is pressed", () => {
    renderDialog();

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("says the passages stay and the writer can rejoin, and nothing about the turn when it is not theirs", async () => {
    const { onOpen } = renderDialog();

    const { dialog } = await openDialog();

    expect(dialog).toHaveTextContent("Your passages stay in the story under your name.");
    expect(dialog).toHaveTextContent("You can rejoin from the invite link.");
    expect(dialog).not.toHaveTextContent("your turn now");
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("stays open under StrictMode, which mounts, cleans up and mounts again", async () => {
    renderPage(
      <StrictMode>
        <LeaveDialog
          turnAfterLeaving={{ type: "unchanged" }}
          leaving={false}
          error={null}
          onOpen={vi.fn<() => void>()}
          onConfirm={vi.fn<() => void>()}
        />
      </StrictMode>,
    );

    await openDialog();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole("alertdialog", { name: "Leave this story?" })).toBeInTheDocument();
  });

  it("says who gets the turn when the writer holds it", async () => {
    renderDialog({ turnAfterLeaving: { type: "passes_to", displayName: "Kim" } });

    const { dialog } = await openDialog();

    expect(dialog).toHaveTextContent("It’s your turn now, so it passes to Kim.");
  });

  it("says the story will wait when no one else can take the turn", async () => {
    renderDialog({ turnAfterLeaving: { type: "waits" } });

    const { dialog } = await openDialog();

    expect(dialog).toHaveTextContent(
      "No one else can take it, so the story will wait for someone to join.",
    );
  });

  it("closes without confirming on Cancel", async () => {
    const { onConfirm } = renderDialog();
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes without confirming on Escape", async () => {
    const { onConfirm } = renderDialog();
    const { user } = await openDialog();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms from the Leave story button inside the dialog, and stays open", async () => {
    const { onConfirm } = renderDialog();
    const { user, dialog } = await openDialog();

    await user.click(within(dialog).getByRole("button", { name: "Leave story" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("disables the button while leaving", async () => {
    renderDialog({ leaving: true });
    const { dialog } = await openDialog();

    expect(within(dialog).getByRole("button", { name: "Leaving…" })).toBeDisabled();
  });

  it("shows why leaving failed", async () => {
    renderDialog({ error: "The story changed just now." });
    const { dialog } = await openDialog();

    expect(within(dialog).getByRole("alert")).toHaveTextContent("The story changed just now.");
  });
});
