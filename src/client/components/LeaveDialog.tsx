import { useEffect, useId, useRef } from "react";

import type { TurnAfterLeaving } from "../storyRules";

interface LeaveDialogProps {
  turnAfterLeaving: TurnAfterLeaving;
  /** True while the request to leave is in flight. */
  leaving: boolean;
  /** Why the last attempt failed, or null. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Asks before leaving a story and says what it costs: the turn passes on if the writer holds it,
 * and they can come back through the invite link. Mount it only while it is open; it is a native
 * modal dialog, so Escape cancels it and the page behind it is out of reach.
 */
export function LeaveDialog({
  turnAfterLeaving,
  leaving,
  error,
  onCancel,
  onConfirm,
}: LeaveDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  // No cleanup: close() queues a `close` event, which would call onCancel. StrictMode runs the
  // effect, its cleanup and the effect again, so that would shut the dialog as it opens.
  // Unmounting removes the dialog anyway.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="modal" aria-labelledby={titleId} onClose={onCancel}>
      <div className="modal-box flex flex-col gap-3">
        <h2 id={titleId} className="font-story text-2xl font-semibold">
          Leave this story?
        </h2>
        <p>
          Your passages stay in the story under your name. You’ll drop out of the turn order.{" "}
          {describeTurn(turnAfterLeaving)}
        </p>
        <p className="text-base-content/70">You can rejoin from the invite link.</p>
        {error !== null && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        <div className="modal-action">
          <button type="button" className="btn min-h-11" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-error min-h-11"
            disabled={leaving}
            onClick={onConfirm}
          >
            {leaving ? "Leaving…" : "Leave story"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function describeTurn(turn: TurnAfterLeaving): string {
  if (turn.type === "passes_to") {
    return `It’s your turn now, so it passes to ${turn.displayName}.`;
  }
  if (turn.type === "waits") {
    return "It’s your turn now. No one else can take it, so the story will wait for someone to join.";
  }

  return "";
}
