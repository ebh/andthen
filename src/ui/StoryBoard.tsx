import { Link, useRouter } from "expo-router";
import { useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import { Anchor, Button, Paragraph, XStack, YStack, useMedia } from "tamagui";

import { createPassage, leaveStory, skipTurn } from "../client/api";
import { describeFailure } from "../client/messages";
import { setLeftStoryNote } from "../client/leftStoryNote";
import {
  CONTRIBUTE_MESSAGES,
  LEAVE_MESSAGES,
  SKIP_MESSAGES,
  isStoryOutOfDate,
} from "../client/storyBoard";
import { isMyTurn, turnAfterLeaving } from "../client/storyRules";
import { useNow } from "../client/useNow";
import { useStoryLive } from "../client/useStoryLive";
import type { StoryView } from "../shared/api";
import { Composer } from "./Composer";
import { ContactLink } from "./ContactLink";
import { InstallButton } from "./InstallButton";
import { InviteLink } from "./InviteLink";
import { LeaveDialog } from "./LeaveDialog";
import { StoryText } from "./StoryText";
import { SuggestButton, SuggestionList, useSuggestions } from "./Suggestions";
import { TurnAlertsSwitch } from "./TurnAlertsSwitch";
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
  const router = useRouter();
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
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

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
      const result = await createPassage(storyId, {
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

  const confirmLeave = (): void => {
    setLeaving(true);
    setLeaveError(null);
    void (async () => {
      const result = await leaveStory(storyId);
      if (result.ok) {
        setLeftStoryNote();
        router.replace("/");
        return;
      }
      setLeaving(false);
      if (isStoryOutOfDate(result.failure)) {
        // The dialog says who gets the turn; the story it was worked out from has moved on.
        refetch();
      }
      setLeaveError(describeFailure(result.failure, LEAVE_MESSAGES));
    })();
  };

  const invite = (
    <YStack gap="4" items="flex-start" w="100%">
      <InviteLink url={`${window.location.origin}/${storyId}`} />
      <LeaveDialog
        turnAfterLeaving={turnAfterLeaving(view)}
        leaving={leaving}
        error={leaveError}
        onOpen={() => {
          setLeaveError(null);
        }}
        onConfirm={confirmLeave}
      />
    </YStack>
  );
  const rail = (
    <YStack gap={media.md ? "14" : "5"} items="flex-start">
      <YStack gap="1" items="flex-start">
        <Wordmark />
        <Link href="/" asChild>
          <Anchor>← Your stories</Anchor>
        </Link>
      </YStack>
      <YStack gap="4" items="flex-start">
        <TurnBanner view={view} now={now} skipping={skipping} onSkip={skip} />
        <TurnAlertsSwitch />
        <InstallButton />
        <ContactLink />
      </YStack>
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
              <Button size="xl" variant="outlined" onPress={refetch}>
                Retry
              </Button>
            </>
          )}
        </YStack>
      )}
      <StoryText passages={view.passages} />
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
        <YStack
          w="80"
          p="8"
          justify="space-between"
          borderRightWidth={1}
          borderColor="border-color"
        >
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
      <YStack p="5" borderBottomWidth={1} borderColor="border-color">
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
          <Button size="xl" variant="outlined" onPress={undo}>
            Undo
          </Button>
        </XStack>
      )}
      <SuggestionList control={suggestions} onUse={chooseSuggestion} />
    </YStack>
  );
}
