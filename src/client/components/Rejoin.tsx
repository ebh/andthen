import { useState } from "react";

import { MAX_PARTICIPANTS } from "../../shared/validation";
import { rejoinStory } from "../api";
import { describeFailure } from "../messages";
import { PageLink } from "./PageLink";

interface RejoinProps {
  storyId: string;
  /** The name the writer had in the story. */
  displayName: string;
  /** The story's first passage, to tell which story this is. */
  opening: string;
  /** Called after the server accepts the rejoin, or says the writer is already back in. */
  onRejoined: () => void;
}

/** What a browser that left the story sees at its address: one button to come back. */
export function Rejoin({ storyId, displayName, opening, onRejoined }: RejoinProps) {
  const [error, setError] = useState<string | null>(null);
  const [rejoining, setRejoining] = useState(false);
  const [full, setFull] = useState(false);

  const rejoin = (): void => {
    setRejoining(true);
    setError(null);
    void (async () => {
      const result = await rejoinStory(storyId);
      setRejoining(false);
      if (
        result.ok ||
        (result.failure.type === "rejected" && result.failure.code === "already_joined")
      ) {
        onRejoined();
        return;
      }
      // A full story stays full: retrying would only fail again.
      setFull(result.failure.type === "rejected" && result.failure.code === "story_full");
      setError(describeFailure(result.failure, FAILURE_MESSAGES));
    })();
  };

  return (
    <>
      <h2 className="font-story text-3xl font-semibold tracking-tight">You left this story</h2>
      <blockquote className="line-clamp-3 font-story text-lg text-base-content/70">
        “{opening}”
      </blockquote>
      <p>Rejoin as {displayName}. You’ll take the last place in the turn order.</p>
      <p role="alert" className="min-h-6 text-error">
        {error}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="btn btn-primary min-h-11"
          disabled={rejoining || full}
          onClick={rejoin}
        >
          {rejoining ? "Rejoining…" : `Rejoin as ${displayName}`}
        </button>
        <PageLink
          to="/"
          className="inline-flex min-h-11 items-center gap-1 text-base-content/70 underline-offset-4 hover:underline"
        >
          <span aria-hidden="true">←</span> Your stories
        </PageLink>
      </div>
    </>
  );
}

const FAILURE_MESSAGES = {
  story_full: `This story is full (${MAX_PARTICIPANTS.toString()} writers), so you can't rejoin it.`,
  stale_turn: "The story just changed. Try again.",
};
