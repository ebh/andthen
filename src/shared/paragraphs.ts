/**
 * Splits turns into paragraphs, oldest first. A turn with `startsParagraph` opens a new one; any
 * other turn continues the paragraph before it. The first turn always opens one, whatever its flag.
 */
export function groupParagraphs<Turn extends { startsParagraph: boolean }>(
  turns: readonly Turn[],
): Turn[][] {
  const paragraphs: Turn[][] = [];

  for (const turn of turns) {
    const current = paragraphs.at(-1);
    if (current === undefined || turn.startsParagraph) {
      paragraphs.push([turn]);
    } else {
      current.push(turn);
    }
  }

  return paragraphs;
}
