import type { PassageView } from "../shared/api";

/** One author of one paragraph: the name beside it, and whose turns to highlight. */
export interface AuthorInParagraph {
  paragraph: number;
  authorId: string;
}

/** Authors in the order they first appear; a repeated author keeps their latest name. */
export function uniqueAuthors(
  turns: readonly PassageView[],
): { authorId: string; authorName: string }[] {
  const authors = new Map<string, string>();
  for (const { authorId, authorName } of turns) {
    authors.set(authorId, authorName);
  }

  return [...authors].map(([authorId, authorName]) => ({ authorId, authorName }));
}

export function isSameAuthor(a: AuthorInParagraph | null, b: AuthorInParagraph): boolean {
  return a !== null && a.paragraph === b.paragraph && a.authorId === b.authorId;
}

/** Pressing the pinned author clears the pin; pressing anyone else moves it to them. */
export function togglePin(
  pinned: AuthorInParagraph | null,
  author: AuthorInParagraph,
): AuthorInParagraph | null {
  return isSameAuthor(pinned, author) ? null : author;
}

/** A previewed author (hover or keyboard focus) wins over the pinned one. */
export function highlightedAuthor(
  previewed: AuthorInParagraph | null,
  pinned: AuthorInParagraph | null,
): AuthorInParagraph | null {
  return previewed ?? pinned;
}
