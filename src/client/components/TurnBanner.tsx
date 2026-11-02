import type { StoryView } from "../../shared/api";
import { describeTimeLeft } from "../format";
import { canSkipTurn, isMyTurn, turnHolder } from "../storyRules";

interface TurnBannerProps {
  view: StoryView;
  now: number;
  skipping: boolean;
  onSkip: () => void;
}

/** Whose turn it is, how long is left, the rotation, and a skip button when the server would accept one. */
export function TurnBanner({ view, now, skipping, onSkip }: TurnBannerProps) {
  const holder = turnHolder(view);

  return (
    <section aria-label="Turn" className="card card-border bg-base-200">
      <div className="card-body gap-3 p-4">
        {/* The only live region: it changes when the turn moves, not every minute. */}
        <p role="status" aria-live="polite" className="text-lg font-semibold">
          {headline(view, holder?.displayName ?? null)}
        </p>
        {view.turn.endsAt !== null && <p>{describeTimeLeft(view.turn.endsAt, now)}</p>}
        <ol aria-label="Turn order" className="flex flex-wrap gap-2">
          {view.participants.map((participant) => (
            <li
              key={participant.id}
              className={`badge ${participant.id === view.turn.holderId ? "badge-primary" : "badge-outline"}`}
            >
              {participant.displayName}
              {participant.id === view.me ? " (you)" : ""}
            </li>
          ))}
        </ol>
        {canSkipTurn(view) && (
          <button
            type="button"
            className="btn btn-outline btn-sm self-start"
            disabled={skipping}
            onClick={onSkip}
          >
            {skipping ? "Skipping…" : `Skip ${holder?.displayName ?? "this turn"}`}
          </button>
        )}
      </div>
    </section>
  );
}

function headline(view: StoryView, holderName: string | null): string {
  if (holderName === null) {
    return "Waiting for someone to join";
  }

  return isMyTurn(view) ? "It's your turn" : `It's ${holderName}'s turn`;
}
