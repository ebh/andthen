import type { KeyboardEvent } from "react";
import { Text } from "tamagui";

import { isRevealKey } from "../client/blocks";
import { standIn } from "../client/standIn";

interface ObscuredPassageProps {
  /** Only its shape is used: the real text never reaches the page. */
  text: string;
  /** Says what is hidden and why; it is the stand-in's whole accessible name. */
  label: string;
  /** Shows the real text. Without it the stand-in is a plain image and cannot be pressed. */
  onReveal?: () => void;
}

/**
 * A blurred stand-in the same length as a passage the user has chosen not to see. It is a span,
 * not a button, so it wraps inline with the words around it; a button would stay one box.
 */
export function ObscuredPassage({ text, label, onReveal }: ObscuredPassageProps) {
  const behaviour =
    onReveal === undefined
      ? { role: "img" as const }
      : {
          role: "button" as const,
          tabIndex: 0,
          cursor: "pointer",
          onPress: onReveal,
          onKeyDown: (event: KeyboardEvent) => {
            if (isRevealKey(event.key)) {
              event.preventDefault();
              onReveal();
            }
          },
        };

  return (
    <Text aria-label={label} {...behaviour}>
      {/* The blur sits on the filler, so a focus ring on the outer span stays sharp. */}
      <Text aria-hidden filter="blur(4px)">
        {standIn(text)}
      </Text>
    </Text>
  );
}
