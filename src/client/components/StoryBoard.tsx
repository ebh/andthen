import { useState } from "react";

import type { StoryView } from "../../shared/api";
import { contribute, skipTurn } from "../api";
import { describeFailure } from "../messages";
import { isMyTurn } from "../storyRules";
import { useNow } from "../useNow";
import { useStoryLive } from "../useStoryLive";
import { Composer } from "./Composer";
import { InviteLink } from "./InviteLink";
import { StoryText } from "./StoryText";
import { Suggestions } from "./Suggestions";
import { TurnBanner } from "./TurnBanner";

interface StoryBoardProps {
  storyId: string;
  view: StoryView;
  /** True when the last reload failed; the story shown may be out of date. */
  refreshFailed: boolean;
  refetch: () => void;
}

const CLOCK_TICK_MS = 10_000;

/** A joined participant's page: the turn, the story, and the composer when it is their turn. */
export function StoryBoard({ storyId, view, refreshFailed, refetch }: StoryBoardProps) {
  useStoryLive({ storyId, endsAt: view.turn.endsAt, refetch });
  const now = useNow(CLOCK_TICK_MS);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const send = (): void => {
    setSending(true);
    setNotice(null);
    void (async () => {
      const result = await contribute(storyId, { text: draft, turnVersion: view.turn.version });
      setSending(false);
      if (result.ok) {
        setDraft("");
        refetch();
        return;
      }
      // The draft stays: after a 409 or 403 the turn may come back, and the text took effort.
      if (result.failure.type === "rejected" && TURN_CHANGED.has(result.failure.code)) {
        refetch();
      }
      setNotice(describeFailure(result.failure, CONTRIBUTE_MESSAGES));
    })();
  };

  const skip = (): void => {
    setSkipping(true);
    setNotice(null);
    void (async () => {
      const result = await skipTurn(storyId, view.turn.version);
      setSkipping(false);
      refetch();
      if (!result.ok) {
        setNotice(describeFailure(result.failure, SKIP_MESSAGES));
      }
    })();
  };

  return (
    <div className="flex flex-col gap-6">
      <TurnBanner view={view} now={now} skipping={skipping} onSkip={skip} />
      <div role="status" aria-live="polite">
        {notice !== null && <div className="alert alert-warning">{notice}</div>}
        {refreshFailed && (
          <div className="alert alert-warning">
            Couldn't refresh the story. What you see may be out of date.
            <button type="button" className="btn btn-sm" onClick={refetch}>
              Retry
            </button>
          </div>
        )}
      </div>
      <StoryText contributions={view.contributions} />
      {isMyTurn(view) && (
        <div className="flex flex-col gap-4">
          <Composer
            label="Your passage"
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            submitting={sending}
            submitLabel="Add to the story"
          />
          <Suggestions storyId={storyId} onUse={setDraft} onTurnLost={refetch} />
        </div>
      )}
      {view.turn.holderId === null && (
        <div className="alert alert-info alert-vertical sm:alert-horizontal">
          Nobody else has joined yet. Send them this link; the first person to join gets the next
          turn.
        </div>
      )}
      <InviteLink url={`${window.location.origin}/${storyId}`} />
    </div>
  );
}

const TURN_CHANGED = new Set(["stale_turn", "not_your_turn"]);

const CONTRIBUTE_MESSAGES = {
  stale_turn:
    "The story changed while you were writing. Your text is kept. Check whose turn it is, then send again.",
  not_your_turn: "It's no longer your turn. Your text is kept in case the turn comes back to you.",
  invalid_passage: "That passage can't be sent. Check that it isn't empty or too long.",
};

const SKIP_MESSAGES = {
  stale_turn: "The turn had already moved on, so nothing was skipped.",
  no_one_to_skip_to: "There's no one else to take the turn.",
  cannot_skip_self: "You can't skip your own turn.",
};
