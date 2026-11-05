import { Link } from "expo-router";
import { useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import { Anchor, Button, Paragraph, XStack, YStack, useMedia } from "tamagui";

import { contribute, skipTurn, type ApiFailure } from "../client/api";
import { describeFailure } from "../client/messages";
import { isMyTurn } from "../client/storyRules";
import { useNow } from "../client/useNow";
import { useStoryLive } from "../client/useStoryLive";
import type { StoryView } from "../shared/api";
import { Composer } from "./Composer";
import { InviteLink } from "./InviteLink";
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

interface YourTurnProps {
  storyId: string;
  draft: string;
  onEdit: (text: string) => void;
  onSubmit: () => void;
  sending: boolean;
  startsParagraph: boolean;
  onStartsParagraphChange: (startsParagraph: boolean) => void;
  replacedDraft: string | null;
  onUndo: () => void;
  onUseSuggestion: (text: string) => void;
  onTurnLost: () => void;
}

const CLOCK_TICK_MS = 10_000;

/** A joined participant's page: the rail beside the story, with the invite link last. */
export function StoryBoard({ storyId, view, refreshFailed, refetch }: StoryBoardProps) {
  useStoryLive({ storyId, endsAt: view.turn.endsAt, refetch });
  const media = useMedia();
  const now = useNow(CLOCK_TICK_MS);
  const [draft, setDraft] = useState("");
  const [startsParagraph, setStartsParagraph] = useState(false);
  // The draft a suggestion replaced, until the next edit.
  const [replacedDraft, setReplacedDraft] = useState<string | null>(null);
  // A notice belongs to the turn version it was raised on: once the story moves on it is stale.
  const [raised, setRaised] = useState<{ text: string; turnVersion: number } | null>(null);
  const notice = raised?.turnVersion === view.turn.version ? raised.text : null;
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
  };

  const undoSuggestion = (): void => {
    if (replacedDraft !== null) {
      setDraft(replacedDraft);
    }
    setReplacedDraft(null);
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
      if (isStoryOutOfDate(result.failure)) {
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

  const invite = <InviteLink url={`${window.location.origin}/${storyId}`} />;
  const rail = (
    <YStack gap={media.md ? "14" : "5"} items="flex-start">
      <YStack gap="1" items="flex-start">
        <Wordmark />
        <Link href="/" asChild>
          <Anchor>← Your stories</Anchor>
        </Link>
      </YStack>
      <TurnBanner view={view} now={now} skipping={skipping} onSkip={skip} />
    </YStack>
  );
  const main = (
    <YStack gap="8" items="stretch">
      {(notice !== null || refreshFailed) && (
        <YStack role="status" gap="2" items="flex-start">
          {notice !== null && <Paragraph>{notice}</Paragraph>}
          {refreshFailed && (
            <>
              <Paragraph>
                Couldn&apos;t refresh the story. What you see may be out of date.
              </Paragraph>
              <Button size="xl" onPress={refetch}>
                Retry
              </Button>
            </>
          )}
        </YStack>
      )}
      <StoryText contributions={view.contributions} />
      {isMyTurn(view) && (
        <YourTurn
          storyId={storyId}
          draft={draft}
          onEdit={edit}
          onSubmit={send}
          sending={sending}
          startsParagraph={startsParagraph}
          onStartsParagraphChange={setStartsParagraph}
          replacedDraft={replacedDraft}
          onUndo={undoSuggestion}
          onUseSuggestion={applySuggestion}
          onTurnLost={refetch}
        />
      )}
      {view.turn.holderId === null && (
        <Paragraph>
          Nobody else has joined yet. Send them the invite link; the first person to join gets the
          next turn.
        </Paragraph>
      )}
    </YStack>
  );

  if (media.md) {
    return (
      <XStack bg="background" grow={1}>
        <YStack w="80" p="8" justify="space-between" borderRightWidth={1} borderColor="base-300">
          {rail}
          {invite}
        </YStack>
        <YStack flex={1} px="16" py="14">
          <YStack maxW="story" w="100%">
            {main}
          </YStack>
        </YStack>
      </XStack>
    );
  }

  return (
    <YStack bg="background" grow={1}>
      <YStack p="5" borderBottomWidth={1} borderColor="base-300">
        {rail}
      </YStack>
      <YStack p="5">{main}</YStack>
      <YStack p="5">{invite}</YStack>
    </YStack>
  );
}

// Mounted only while it is the reader's turn, so suggestions asked for in one turn are gone by the next.
function YourTurn(props: YourTurnProps) {
  const suggestions = useSuggestions(props.storyId, props.onTurnLost);
  const field = useRef<TextInputInstance>(null);

  const chooseSuggestion = (text: string): void => {
    props.onUseSuggestion(text);
    field.current?.focus();
  };

  const undo = (): void => {
    props.onUndo();
    field.current?.focus();
  };

  return (
    <YStack gap="4">
      <Composer
        label="Your passage"
        value={props.draft}
        onChange={props.onEdit}
        onSubmit={props.onSubmit}
        submitting={props.sending}
        submitLabel="Add to the story"
        fieldRef={field}
        newParagraph={{ checked: props.startsParagraph, onChange: props.onStartsParagraphChange }}
        extraAction={<SuggestButton control={suggestions} />}
      />
      {props.replacedDraft !== null && (
        <XStack items="center" gap="2">
          <Paragraph>Your draft was replaced by the suggestion.</Paragraph>
          <Button size="xl" onPress={undo}>
            Undo
          </Button>
        </XStack>
      )}
      <SuggestionList control={suggestions} onUse={chooseSuggestion} />
    </YStack>
  );
}

// Each of these means the page's picture of the story is out of date. `not_participant` sends
// the refetch to a 403, which swaps the page for the join form.
const REFETCH_CODES = new Set(["stale_turn", "not_your_turn", "not_participant"]);

// `left_story` is the same, with the refetch swapping the page for the rejoin screen.
function isStoryOutOfDate(failure: ApiFailure): boolean {
  return (
    failure.type === "left_story" ||
    (failure.type === "rejected" && REFETCH_CODES.has(failure.code))
  );
}

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
