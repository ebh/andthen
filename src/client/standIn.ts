// Letters of mixed width, so a blurred stand-in does not read as a ruler of identical glyphs.
const FILLER = "etaoinshrdlu";

const graphemes = new Intl.Segmenter();

/**
 * Text of the same shape as `text`, to be drawn blurred in its place. Spaces and newlines stay, so
 * the stand-in wraps at the same words; every other character becomes a filler letter. A character
 * made of several code points, such as an emoji with a joiner or a letter with an accent, becomes
 * one letter, as it takes one place on the line. It is deterministic, so a render and a test see
 * the same stand-in.
 */
export function standIn(text: string): string {
  let index = 0;
  let hidden = "";

  for (const { segment } of graphemes.segment(text)) {
    if (/^\s+$/u.test(segment)) {
      hidden += segment;
    } else {
      hidden += FILLER.charAt(index % FILLER.length);
      index += 1;
    }
  }

  return hidden;
}
