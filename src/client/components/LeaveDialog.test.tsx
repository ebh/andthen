// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TurnAfterLeaving } from "../storyRules";
import { LeaveDialog } from "./LeaveDialog";

function renderDialog(
  overrides: Partial<{
    turnAfterLeaving: TurnAfterLeaving;
    leaving: boolean;
    error: string | null;
  }> = {},
) {
  const onCancel = vi.fn<() => void>();
  const onConfirm = vi.fn<() => void>();
  render(
    <LeaveDialog
      turnAfterLeaving={{ type: "unchanged" }}
      leaving={false}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );

  return { onCancel, onConfirm };
}

describe("LeaveDialog", () => {
  it("opens as a modal dialog and says the passages stay and the writer can rejoin", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "Leave this story?" });
    expect(dialog).toHaveTextContent("Your passages stay in the story under your name.");
    expect(dialog).toHaveTextContent("You can rejoin from the invite link.");
    expect(dialog).not.toHaveTextContent("your turn now");
  });

  it("stays open under StrictMode, which runs its effect, cleans up and runs it again", async () => {
    const onCancel = vi.fn<() => void>();
    render(
      <StrictMode>
        <LeaveDialog
          turnAfterLeaving={{ type: "unchanged" }}
          leaving={false}
          error={null}
          onCancel={onCancel}
          onConfirm={vi.fn<() => void>()}
        />
      </StrictMode>,
    );

    // A browser queues the `close` event of the cleanup's close() as a task.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Leave this story?" })).toHaveAttribute("open");
  });

  it("says who gets the turn when the writer holds it", () => {
    renderDialog({ turnAfterLeaving: { type: "passes_to", displayName: "Kim" } });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "It’s your turn now, so it passes to Kim.",
    );
  });

  it("says the story will wait when no one else can take the turn", () => {
    renderDialog({ turnAfterLeaving: { type: "waits" } });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "No one else can take it, so the story will wait for someone to join.",
    );
  });

  it("cancels from the Cancel button and from Escape, and confirms from Leave story", async () => {
    const { onCancel, onConfirm } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent(screen.getByRole("dialog"), new Event("close"));
    await user.click(screen.getByRole("button", { name: "Leave story" }));

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables the button while leaving", () => {
    renderDialog({ leaving: true });

    expect(screen.getByRole("button", { name: "Leaving…" })).toBeDisabled();
  });

  it("shows why leaving failed", () => {
    renderDialog({ error: "The story changed just now." });

    expect(screen.getByRole("alert")).toHaveTextContent("The story changed just now.");
  });
});
