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
    <section aria-label="Turn" className="flex flex-col gap-2">
      {/* The only live region: it changes when the turn moves, not every minute. */}
      <p
        role="status"
        aria-live="polite"
        className={`font-story text-xl font-semibold md:text-3xl md:leading-tight ${isMyTurn(view) ? "text-primary" : ""}`}
      >
        {headline(view, holder?.displayName ?? null)}
      </p>
      {view.turn.endsAt !== null && (
        <p className="text-sm text-base-content/70">{describeTimeLeft(view.turn.endsAt, now)}</p>
      )}
      <ol aria-label="Turn order" className="flex flex-wrap gap-2 md:mt-4 md:flex-col md:gap-1">
        {view.participants.map((participant) => {
          const current = participant.id === view.turn.holderId;

          return (
            <li
              key={participant.id}
              className={`flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm md:gap-3 md:rounded-lg md:px-2.5 md:py-2 md:text-base ${current ? "bg-primary/10 font-semibold" : "text-base-content/70"}`}
            >
              <span
                aria-hidden="true"
                className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold md:size-7 ${current ? "bg-primary text-primary-content" : "bg-secondary text-secondary-content"}`}
              >
                {initial(participant.displayName)}
              </span>
              <span>
                {participant.displayName}
                {participant.id === view.me ? " (you)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {canSkipTurn(view) && (
        <button
          type="button"
          className="btn btn-outline mt-2 min-h-11 self-start"
          disabled={skipping}
          onClick={onSkip}
        >
          {skipping ? "Skipping…" : `Skip ${holder?.displayName ?? "this turn"}`}
        </button>
      )}
    </section>
  );
}

function headline(view: StoryView, holderName: string | null): string {
  if (holderName === null) {
    return "Waiting for someone to join";
  }

  return isMyTurn(view) ? "It's your turn" : `It's ${holderName}'s turn`;
}

/** The first character of a name, whole even when it is an emoji or another multi-unit character. */
function initial(displayName: string): string {
  return Array.from(displayName)[0]?.toLocaleUpperCase() ?? "";
}
