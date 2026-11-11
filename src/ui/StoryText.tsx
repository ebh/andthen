import { useEffect, useId, useRef, useState } from "react";
import {
  Label,
  Paragraph,
  Switch,
  Text,
  type TamaguiTextElement,
  XStack,
  YStack,
  styled,
  useMedia,
} from "tamagui";

import {
  highlightedAuthor,
  isSameAuthor,
  togglePin,
  uniqueAuthors,
  type AuthorInParagraph,
} from "../client/authorHighlight";
import { blocksNotice } from "../client/blockMessages";
import { isObscured, revealFor, type Reveal } from "../client/blocks";
import { blockOffer } from "../client/storyRules";
import { useBlocks, type BlocksValue } from "../client/useBlocks";
import type { PassageView } from "../shared/api";
import { groupParagraphs } from "../shared/paragraphs";
import { AuthorMenu } from "./AuthorMenu";
import { ObscuredPassage } from "./ObscuredPassage";

interface StoryTextProps {
  passages: readonly PassageView[];
  /** The viewer's user ID: their own passages are never obscured, and the menu never offers to block them. */
  myUserId: string;
}

interface ParagraphViewProps {
  myUserId: string;
  blocks: BlocksValue;
  turns: readonly PassageView[];
  paragraph: number;
  showAuthors: boolean;
  highlighted: AuthorInParagraph | null;
  pinned: AuthorInParagraph | null;
  onPreview: (author: AuthorInParagraph | null) => void;
  onTogglePin: (author: AuthorInParagraph) => void;
}

const StoryParagraph = styled(Paragraph, { render: "p" });

const HighlightedTurn = styled(Text, { render: "mark", bg: "highlight", color: "color" });

/**
 * The story as paragraphs, oldest first. Authors are there for accountability, not reading, so
 * they stay out of the prose: each paragraph lists its authors once in a margin beside it from
 * `md` up, and behind a toggle below it, where there is no room for a margin. Pointing at an
 * author highlights their turns in the paragraph: hovering with a mouse or keyboard focus
 * previews it, and the author's menu pins it until the next pin. The menu also blocks and unblocks
 * the author; a blocked author's passages show as obscured stand-ins, and so do everyone else's
 * until the user's blocks have loaded. Text is rendered as plain text.
 */
export function StoryText({ passages, myUserId }: StoryTextProps) {
  const media = useMedia();
  const toggleId = useId();
  const blocks = useBlocks();
  const [showAuthors, setShowAuthors] = useState(false);
  const [previewed, setPreviewed] = useState<AuthorInParagraph | null>(null);
  const [pinned, setPinned] = useState<AuthorInParagraph | null>(null);

  const pressAuthor = (author: AuthorInParagraph): void => {
    setPinned(togglePin(pinned, author));
  };

  const changeShowAuthors = (show: boolean): void => {
    setShowAuthors(show);
    setPinned(null);
  };

  return (
    <YStack gap="4">
      {!media.md && (
        <XStack items="center" gap="3" self="flex-end">
          <Label htmlFor={toggleId}>Show authors</Label>
          <Switch id={toggleId} size="xl" checked={showAuthors} onCheckedChange={changeShowAuthors}>
            <Switch.Thumb />
          </Switch>
        </XStack>
      )}
      <BlocksNotice blocks={blocks} />
      <YStack role="region" aria-label="The story so far" gap="8">
        {groupParagraphs(passages).map((turns, paragraph) => (
          <ParagraphView
            key={turns[0]?.id}
            myUserId={myUserId}
            blocks={blocks}
            turns={turns}
            paragraph={paragraph}
            showAuthors={media.md || showAuthors}
            highlighted={highlightedAuthor(previewed, pinned)}
            pinned={pinned}
            onPreview={setPreviewed}
            onTogglePin={pressAuthor}
          />
        ))}
      </YStack>
    </YStack>
  );
}

function BlocksNotice({ blocks }: { blocks: BlocksValue }) {
  // One row for the whole story, across the full column so a message wraps as little as possible.
  // Both regions are always mounted and keep their role, because a screen reader skips text that
  // arrives in the same render as a role change. At most one has text, and the messages fit one
  // row, so the row holds its height and the story does not move.
  const { progress, failure } = blocksNotice(blocks);

  return (
    <YStack minH="6">
      <Paragraph role="status" color="muted">
        {progress}
      </Paragraph>
      <Paragraph role="alert" color="error">
        {failure}
      </Paragraph>
    </YStack>
  );
}

function ParagraphView({
  myUserId,
  blocks,
  turns,
  paragraph,
  showAuthors,
  highlighted,
  pinned,
  onPreview,
  onTogglePin,
}: ParagraphViewProps) {
  // Tamagui tracks only the media keys a component reads, so read both here, not inside the author branch.
  const { md, hoverable } = useMedia();

  return (
    <YStack
      flexDirection={md ? "row" : "column-reverse"}
      gap={md ? "8" : "2"}
      items={md ? "flex-start" : "stretch"}
    >
      <StoryParagraph
        flex={md ? 3 : undefined}
        maxW={md ? "passage" : undefined}
        fontFamily="story"
        fontSize={md ? "2xl" : "xl"}
        lineHeight={md ? "2xl" : "xl"}
        whiteSpace="pre-wrap"
      >
        {turns.map((turn, index) => (
          <Turn
            key={turn.id}
            turn={turn}
            myUserId={myUserId}
            blocks={blocks}
            separated={index > 0}
            highlighted={isSameAuthor(highlighted, { paragraph, authorId: turn.authorId })}
          />
        ))}
      </StoryParagraph>
      {showAuthors && (
        <YStack
          role="list"
          flex={md ? 1 : undefined}
          maxW={md ? "36" : undefined}
          flexDirection={md ? "column" : "row"}
          flexWrap="wrap"
          columnGap="4"
          borderTopWidth={md ? 1 : 0}
          borderColor="border-color"
        >
          {uniqueAuthors(turns).map(({ authorId, authorName }) => {
            const author = { paragraph, authorId };
            const offer = blockOffer({
              authorId,
              authorName,
              myUserId,
              blockId: blocks.blockIdFor(authorId),
            });

            return (
              <YStack key={authorId} role="listitem" items="flex-start">
                <AuthorMenu
                  name={authorName}
                  offer={offer}
                  busy={blocks.working !== null}
                  onBlockChange={() => {
                    const user = { id: authorId, name: authorName };
                    if (offer.type === "block") {
                      blocks.block(user);
                    } else {
                      blocks.unblock(user);
                    }
                  }}
                  highlighted={isSameAuthor(highlighted, author)}
                  pinned={isSameAuthor(pinned, author)}
                  hoverable={hoverable}
                  onPreview={(on) => {
                    onPreview(on ? author : null);
                  }}
                  onTogglePin={() => {
                    onTogglePin(author);
                  }}
                />
              </YStack>
            );
          })}
        </YStack>
      )}
    </YStack>
  );
}

function Turn({
  turn,
  myUserId,
  blocks,
  separated,
  highlighted,
}: {
  turn: PassageView;
  myUserId: string;
  blocks: BlocksValue;
  separated: boolean;
  highlighted: boolean;
}) {
  const blockId = blocks.blockIdFor(turn.authorId);
  const [stored, setReveal] = useState<Reveal>({ blockId, shown: false });
  const revealedText = useRef<TamaguiTextElement>(null);

  const reveal = revealFor(stored, blockId);
  if (reveal !== stored) {
    setReveal(reveal);
  }
  const { shown } = reveal;

  // Pressing the stand-in removes the focused element; the text that replaces it takes the focus.
  useEffect(() => {
    if (shown) {
      revealedText.current?.focus();
    }
  }, [shown]);

  const text = shown ? { ref: revealedText, tabIndex: -1 } : {};

  return (
    <>
      {separated && " "}
      {!shown && isObscured(blocks.status, blockId, turn.authorId === myUserId) ? (
        <ObscuredPassage
          text={turn.text}
          label={`Passage by ${turn.authorName}, hidden because you blocked them`}
          onReveal={() => {
            setReveal({ blockId, shown: true });
          }}
        />
      ) : highlighted ? (
        <HighlightedTurn {...text}>{turn.text}</HighlightedTurn>
      ) : (
        <Text {...text}>{turn.text}</Text>
      )}
    </>
  );
}
