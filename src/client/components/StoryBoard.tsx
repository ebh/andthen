import type { Ref } from "react";
import { useRef, useState } from "react";

import type { StoryView } from "../../shared/api";
import { contribute, skipTurn } from "../api";
import { describeFailure } from "../messages";
import { isMyTurn } from "../storyRules";
import { useNow } from "../useNow";
import { useStoryLive } from "../useStoryLive";
import { Composer } from "./Composer";
import { InviteLink } from "./InviteLink";
import { PageLink } from "./PageLink";
import { StoryText } from "./StoryText";
import { SuggestButton, SuggestionList, useSuggestions } from "./Suggestions";
import { TurnBanner } from "./TurnBanner";
import { Wordmark } from "./Wordmark";

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
  const [startsParagraph, setStartsParagraph] = useState(false);
  // The draft a suggestion replaced, until the next edit.
  const [replacedDraft, setReplacedDraft] = useState<string | null>(null);
  // A notice belongs to the turn version it was raised on: once the story moves on it is stale.
  const [raised, setRaised] = useState<{ text: string; turnVersion: number } | null>(null);
  const notice = raised?.turnVersion === view.turn.version ? raised.text : null;
  const composerField = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const setNotice = (text: string | null): void => {
    setRaised(text === null ? null : { text, turnVersion: view.turn.version });
  };

  const edit = (text: string): void => {
    setDraft(text);
    setReplacedDraft(null);
  };

  const applySuggestion = (text: string): void => {
    setReplacedDraft(draft.trim() === "" || draft === text ? null : draft);
    setDraft(text);
    composerField.current?.focus();
  };

  const undoSuggestion = (): void => {
    if (replacedDraft !== null) {
      setDraft(replacedDraft);
    }
    setReplacedDraft(null);
    composerField.current?.focus();
  };

  const send = (): void => {
    setSending(true);
    setNotice(null);
    void (async () => {
      const result = await contribute(storyId, {
        text: draft,
        turnVersion: view.turn.version,
        startsParagraph,
      });
      setSending(false);
      if (result.ok) {
        edit("");
        setStartsParagraph(false);
        refetch();
        return;
      }
      // The draft stays: after a 409 or 403 the turn may come back, and the text took effort.
      if (result.failure.type === "rejected" && REFETCH_CODES.has(result.failure.code)) {
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
    <div className="min-h-screen md:grid md:grid-cols-[17.5rem_1fr] md:grid-rows-[auto_1fr]">
      <aside className="flex flex-col gap-5 border-b border-base-300 p-5 md:col-start-1 md:row-start-1 md:gap-14 md:border-r md:border-b-0 md:p-8">
        <div className="flex flex-col gap-1">
          <Wordmark />
          <PageLink
            to="/"
            className="inline-flex min-h-11 items-center gap-1 text-sm text-base-content/70 underline-offset-4 hover:underline"
          >
            <span aria-hidden="true">←</span> Your stories
          </PageLink>
        </div>
        <TurnBanner view={view} now={now} skipping={skipping} onSkip={skip} />
      </aside>
      <main className="p-5 md:col-start-2 md:row-span-2 md:row-start-1 md:px-16 md:py-14">
        <div className="flex w-full max-w-[49.75rem] flex-col gap-8">
          <div role="status" aria-live="polite" className="empty:hidden">
            {notice !== null && <div className="alert alert-warning">{notice}</div>}
            {refreshFailed && (
              <div className="alert alert-warning">
                Couldn't refresh the story. What you see may be out of date.
                <button type="button" className="btn min-h-11" onClick={refetch}>
                  Retry
                </button>
              </div>
            )}
          </div>
          <StoryText contributions={view.contributions} />
          {isMyTurn(view) && (
            <YourTurn
              storyId={storyId}
              draft={draft}
              onEdit={edit}
              onSubmit={send}
              sending={sending}
              fieldRef={composerField}
              startsParagraph={startsParagraph}
              onStartsParagraphChange={setStartsParagraph}
              replacedDraft={replacedDraft}
              onUndo={undoSuggestion}
              onUseSuggestion={applySuggestion}
              onTurnLost={refetch}
            />
          )}
          {view.turn.holderId === null && (
            <div className="alert alert-info alert-vertical sm:alert-horizontal">
              Nobody else has joined yet. Send them this link; the first person to join gets the
              next turn.
            </div>
          )}
        </div>
      </main>
      <div className="p-5 md:col-start-1 md:row-start-2 md:flex md:flex-col md:justify-end md:border-r md:border-base-300 md:p-8">
        <InviteLink url={`${window.location.origin}/${storyId}`} />
      </div>
    </div>
  );
}

interface YourTurnProps {
  storyId: string;
  draft: string;
  onEdit: (text: string) => void;
  onSubmit: () => void;
  sending: boolean;
  fieldRef: Ref<HTMLTextAreaElement>;
  startsParagraph: boolean;
  onStartsParagraphChange: (startsParagraph: boolean) => void;
  replacedDraft: string | null;
  onUndo: () => void;
  onUseSuggestion: (text: string) => void;
  onTurnLost: () => void;
}

// Mounted only while it is the reader's turn, so suggestions asked for in one turn are gone by the next.
function YourTurn(props: YourTurnProps) {
  const suggestions = useSuggestions(props.storyId, props.onTurnLost);

  return (
    <div className="flex flex-col gap-4">
      <Composer
        label="Your passage"
        value={props.draft}
        onChange={props.onEdit}
        onSubmit={props.onSubmit}
        submitting={props.sending}
        submitLabel="Add to the story"
        fieldRef={props.fieldRef}
        newParagraph={{ checked: props.startsParagraph, onChange: props.onStartsParagraphChange }}
        extraAction={<SuggestButton control={suggestions} />}
      />
      {props.replacedDraft !== null && (
        <p className="flex items-center gap-2 text-sm">
          Your draft was replaced by the suggestion.
          <button type="button" className="btn btn-sm" onClick={props.onUndo}>
            Undo
          </button>
        </p>
      )}
      <SuggestionList control={suggestions} onUse={props.onUseSuggestion} />
    </div>
  );
}

// Each of these means the page's picture of the story is out of date. `not_participant` sends
// the refetch to a 403, which swaps the page for the join form.
const REFETCH_CODES = new Set(["stale_turn", "not_your_turn", "not_participant"]);

const CONTRIBUTE_MESSAGES = {
  stale_turn:
    "The story changed while you were writing. Your text is kept. Check whose turn it is, then send again.",
  not_your_turn: "It's no longer your turn. Your text is kept in case the turn comes back to you.",
  not_participant: "You're not part of this story. Join it to write.",
  invalid_passage: "That passage can't be sent. Check that it isn't empty or too long.",
};

const SKIP_MESSAGES = {
  stale_turn: "The turn had already moved on, so nothing was skipped.",
  no_one_to_skip_to: "There's no one else to take the turn.",
  not_participant: "You're not part of this story. Join it to write.",
  cannot_skip_self: "You can't skip your own turn.",
};
