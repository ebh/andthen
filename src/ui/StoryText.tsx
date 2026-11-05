import { useId, useState } from "react";
import type { FocusEvent } from "react";
import { Button, Label, Paragraph, Switch, Text, XStack, YStack, styled, useMedia } from "tamagui";

import type { ContributionView } from "../shared/api";
import { groupParagraphs } from "../shared/paragraphs";

interface StoryTextProps {
  contributions: readonly ContributionView[];
}

/** One author of one paragraph: the name beside it, and whose turns to highlight. */
interface AuthorInParagraph {
  paragraph: number;
  authorId: string;
}

interface ParagraphViewProps {
  turns: readonly ContributionView[];
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
 * author highlights their turns in the paragraph: hovering with a mouse, keyboard focus, or a
 * press, which pins the highlight until the next one. Text is rendered as plain text.
 */
export function StoryText({ contributions }: StoryTextProps) {
  const media = useMedia();
  const toggleId = useId();
  const [showAuthors, setShowAuthors] = useState(false);
  const [previewed, setPreviewed] = useState<AuthorInParagraph | null>(null);
  const [pinned, setPinned] = useState<AuthorInParagraph | null>(null);

  const togglePin = (author: AuthorInParagraph): void => {
    setPinned(isSame(pinned, author) ? null : author);
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
      <YStack role="region" aria-label="The story so far" gap="8">
        {groupParagraphs(contributions).map((turns, paragraph) => (
          <ParagraphView
            key={turns[0]?.id}
            turns={turns}
            paragraph={paragraph}
            showAuthors={media.md || showAuthors}
            highlighted={previewed ?? pinned}
            pinned={pinned}
            onPreview={setPreviewed}
            onTogglePin={togglePin}
          />
        ))}
      </YStack>
    </YStack>
  );
}

function ParagraphView({
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
            separated={index > 0}
            highlighted={isSame(highlighted, { paragraph, authorId: turn.authorId })}
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
          borderColor="base-300"
        >
          {uniqueAuthors(turns).map(({ authorId, authorName }) => {
            const author = { paragraph, authorId };

            return (
              <YStack key={authorId} role="listitem" items="flex-start">
                <AuthorButton
                  name={authorName}
                  highlighted={isSame(highlighted, author)}
                  pinned={isSame(pinned, author)}
                  hoverable={hoverable}
                  onPreview={(on) => {
                    onPreview(on ? author : null);
                  }}
                  onPress={() => {
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

interface AuthorButtonProps {
  name: string;
  highlighted: boolean;
  pinned: boolean;
  /** Whether the device has a pointer that hovers; touch devices fire emulated hovers on tap. */
  hoverable: boolean;
  onPreview: (on: boolean) => void;
  onPress: () => void;
}

function AuthorButton({
  name,
  highlighted,
  pinned,
  hoverable,
  onPreview,
  onPress,
}: AuthorButtonProps) {
  const preview = (on: boolean) =>
    hoverable
      ? () => {
          onPreview(on);
        }
      : undefined;

  return (
    <Button
      size="xl"
      px="0"
      variant="quiet"
      aria-pressed={pinned}
      onPress={onPress}
      onMouseEnter={preview(true)}
      onMouseLeave={preview(false)}
      onFocus={(event) => {
        // A press also focuses the button; only keyboard focus previews, or the press would
        // find the highlight already on and its second press could not switch it off.
        if (isKeyboardFocus(event)) {
          onPreview(true);
        }
      }}
      onBlur={() => {
        onPreview(false);
      }}
    >
      <Button.Text textDecorationLine={highlighted ? "underline" : "none"}>{name}</Button.Text>
    </Button>
  );
}

function Turn({
  turn,
  separated,
  highlighted,
}: {
  turn: ContributionView;
  separated: boolean;
  highlighted: boolean;
}) {
  return (
    <>
      {separated && " "}
      {highlighted ? <HighlightedTurn>{turn.text}</HighlightedTurn> : <Text>{turn.text}</Text>}
    </>
  );
}

function uniqueAuthors(
  turns: readonly ContributionView[],
): { authorId: string; authorName: string }[] {
  const authors = new Map<string, string>();
  for (const { authorId, authorName } of turns) {
    authors.set(authorId, authorName);
  }

  return [...authors].map(([authorId, authorName]) => ({ authorId, authorName }));
}

function isSame(a: AuthorInParagraph | null, b: AuthorInParagraph): boolean {
  return a !== null && a.paragraph === b.paragraph && a.authorId === b.authorId;
}

function isKeyboardFocus(event: FocusEvent): boolean {
  return (
    event.currentTarget instanceof HTMLElement && event.currentTarget.matches(":focus-visible")
  );
}
