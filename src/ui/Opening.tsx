import { OPENING_HIDDEN_LABEL } from "../client/blockMessages";
import { isOpeningObscured } from "../client/blocks";
import { useBlocks } from "../client/useBlocks";
import { ObscuredPassage } from "./ObscuredPassage";

interface OpeningProps {
  text: string;
  /** The user ID of the opening's author: the user may have blocked them. Missing means unknown. */
  authorId: string | undefined;
  /** Wraps the text in quotation marks. The stand-in carries none. */
  quoted?: boolean;
}

/** A story's opening passage outside the story, or an obscured stand-in when its author is blocked. */
export function Opening({ text, authorId, quoted = false }: OpeningProps) {
  const blocks = useBlocks();

  if (isOpeningObscured(blocks, authorId)) {
    return <ObscuredPassage text={text} label={OPENING_HIDDEN_LABEL} />;
  }

  return quoted ? `“${text}”` : text;
}
