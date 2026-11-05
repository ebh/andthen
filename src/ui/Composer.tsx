import type { ReactNode, Ref } from "react";
import { useId } from "react";
import type { TextInputInstance } from "react-native";
import {
  Button,
  Checkbox,
  Form,
  Label,
  Paragraph,
  TextArea,
  XStack,
  YStack,
  useMedia,
} from "tamagui";

import { MAX_PASSAGE_LENGTH, passageLength, validatePassage } from "../shared/validation";

interface ComposerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  /** Lets the parent move focus into the field, e.g. after filling it. */
  fieldRef: Ref<TextInputInstance>;
  newParagraph: { checked: boolean; onChange: (checked: boolean) => void };
  /** A secondary action, placed beside the submit button. */
  extraAction: ReactNode;
}

/** A passage editor with a live grapheme counter. The parent owns the text so it survives a failed submit. */
export function Composer({
  label,
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  fieldRef,
  newParagraph,
  extraAction,
}: ComposerProps) {
  const media = useMedia();
  const fieldId = useId();
  const counterId = useId();
  const newParagraphId = useId();
  const length = passageLength(value);
  const tooLong = length > MAX_PASSAGE_LENGTH;
  const canSubmit = validatePassage(value).ok && !submitting;

  return (
    <Form
      onSubmit={() => {
        if (canSubmit) {
          onSubmit();
        }
      }}
      gap="2"
      w="100%"
    >
      <Label htmlFor={fieldId}>{label}</Label>
      <TextArea
        ref={fieldRef}
        id={fieldId}
        size="xl"
        fontFamily="story"
        value={value}
        onChangeText={onChange}
        aria-describedby={counterId}
        aria-invalid={tooLong}
      />
      <XStack items="center" gap="3">
        <Checkbox
          id={newParagraphId}
          size="xl"
          checked={newParagraph.checked}
          onCheckedChange={(checked) => {
            newParagraph.onChange(checked === true);
          }}
        >
          <Checkbox.Indicator>
            {/* A typed tick until the documented icon package supports this Tamagui version: #24 */}
            <Paragraph aria-hidden>✓</Paragraph>
          </Checkbox.Indicator>
        </Checkbox>
        <Label htmlFor={newParagraphId}>New paragraph</Label>
      </XStack>
      <XStack flexWrap="wrap" items="center" justify="space-between" gap="2">
        <Paragraph id={counterId} color={tooLong ? "error" : "muted"}>
          {length} / {MAX_PASSAGE_LENGTH}
          {tooLong ? " (too long)" : ""}
        </Paragraph>
        <YStack
          gap="2"
          w={media.md ? undefined : "100%"}
          flexDirection={media.md ? "row" : "column"}
        >
          {extraAction}
          <Form.Trigger asChild>
            <Button size="xl" disabled={!canSubmit}>
              {submitting ? "Sending…" : submitLabel}
            </Button>
          </Form.Trigger>
        </YStack>
      </XStack>
    </Form>
  );
}
