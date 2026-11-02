import { useState } from "react";
import type { PointerEvent } from "react";

import type { ContributionView } from "../../shared/api";
import { groupParagraphs } from "../../shared/paragraphs";

interface StoryTextProps {
  contributions: readonly ContributionView[];
}

/** One author of one paragraph: the name in the margin, and whose turns to highlight. */
interface AuthorInParagraph {
  paragraph: number;
  authorId: string;
}

interface TurnProps {
  turn: ContributionView;
  separated: boolean;
  highlighted: boolean;
}

/**
 * The story as paragraphs, oldest first. Authors are there for accountability, not reading, so
 * they stay out of the prose: each paragraph lists its authors once in a margin beside it on wide
 * screens, and behind a toggle on narrow ones, where there is no room for a margin. Pointing at an
 * author highlights their turns in the paragraph: hovering with a mouse, keyboard focus, or a
 * click or tap, which pins the highlight until the next one. Text is rendered as plain text.
 */
export function StoryText({ contributions }: StoryTextProps) {
  const [showAuthors, setShowAuthors] = useState(false);
  const [previewed, setPreviewed] = useState<AuthorInParagraph | null>(null);
  const [pinned, setPinned] = useState<AuthorInParagraph | null>(null);
  const highlighted = previewed ?? pinned;

  const togglePin = (author: AuthorInParagraph): void => {
    setPinned(isSame(pinned, author) ? null : author);
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-11 items-center gap-3 self-end text-sm text-base-content/70 md:hidden">
        <input
          type="checkbox"
          className="toggle toggle-sm toggle-primary"
          checked={showAuthors}
          onChange={(event) => {
            setShowAuthors(event.target.checked);
            setPinned(null);
          }}
        />
        Show authors
      </label>
      <section aria-label="The story so far" className="flex flex-col gap-8">
        {groupParagraphs(contributions).map((turns, paragraph) => (
          <div
            key={turns[0]?.id}
            className="flex flex-col-reverse md:grid md:grid-cols-[minmax(0,38.75rem)_minmax(0,1fr)] md:items-start md:gap-x-8"
          >
            <p className="font-story text-xl leading-relaxed whitespace-pre-wrap md:text-[1.5625rem] md:leading-relaxed">
              {turns.map((turn, index) => (
                <Turn
                  key={turn.id}
                  turn={turn}
                  separated={index > 0}
                  highlighted={isSame(highlighted, { paragraph, authorId: turn.authorId })}
                />
              ))}
            </p>
            <ul
              className={`${showAuthors ? "mb-1.5" : "hidden"} flex flex-col md:mt-3.5 md:mb-0 md:flex md:border-t md:border-base-300 md:pt-1`}
            >
              {uniqueAuthors(turns).map(({ authorId, authorName }) => {
                const author = { paragraph, authorId };
                return (
                  <li key={authorId}>
                    <button
                      type="button"
                      aria-pressed={isSame(pinned, author)}
                      className={`min-h-11 text-left text-xs font-semibold tracking-wider uppercase md:text-[0.8125rem] ${isSame(highlighted, author) ? "text-base-content underline" : "text-base-content/70"}`}
                      onClick={() => {
                        togglePin(author);
                      }}
                      onPointerEnter={(event) => {
                        if (isMouse(event)) {
                          setPreviewed(author);
                        }
                      }}
                      onPointerLeave={(event) => {
                        if (isMouse(event)) {
                          setPreviewed(null);
                        }
                      }}
                      onFocus={(event) => {
                        // A click or tap also focuses the button; only keyboard focus previews,
                        // or the click would find the highlight already on and switch it off.
                        if (event.currentTarget.matches(":focus-visible")) {
                          setPreviewed(author);
                        }
                      }}
                      onBlur={() => {
                        setPreviewed(null);
                      }}
                    >
                      {authorName}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function Turn({ turn, separated, highlighted }: TurnProps) {
  return (
    <>
      {separated && " "}
      {highlighted ? (
        <mark className="rounded-sm bg-primary/20 text-inherit">{turn.text}</mark>
      ) : (
        <span>{turn.text}</span>
      )}
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

// Touch fires emulated pointer enter and leave events, which would undo a tap.
function isMouse(event: PointerEvent): boolean {
  return event.pointerType === "mouse";
}
