import { useRouter } from "expo-router";
import { useId, useState } from "react";
import {
  Button,
  Form,
  H2,
  Input,
  Label,
  Paragraph,
  TextArea,
  useMedia,
  XStack,
  YStack,
} from "tamagui";

import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSAGE_LENGTH,
  passageLength,
  validateDisplayName,
  validatePassage,
} from "../shared/validation";
import { createStory } from "../client/api";
import { describeFailure } from "../client/messages";
import { Wordmark } from "./Wordmark";

/** `/`: pick a name, write the opening passage, get a story link. */
export function NewStory() {
  const router = useRouter();
  const media = useMedia();
  const nameId = useId();
  const openingId = useId();
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const length = passageLength(opening);
  const tooLong = length > MAX_PASSAGE_LENGTH;
  const canSubmit = validatePassage(opening).ok && !submitting;

  const start = (): void => {
    const checkedName = validateDisplayName(name);
    const checkedOpening = validatePassage(opening);
    if (!checkedName.ok) {
      setError(
        checkedName.reason === "empty"
          ? "Enter a name."
          : `Names can be at most ${MAX_DISPLAY_NAME_LENGTH.toString()} characters.`,
      );
      return;
    }
    if (!checkedOpening.ok || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    void (async () => {
      const result = await createStory({
        displayName: checkedName.value,
        opening: checkedOpening.value,
      });
      if (result.ok) {
        router.push(`/${result.value.storyId}`);
        return;
      }
      setSubmitting(false);
      setError(describeFailure(result.failure));
    })();
  };

  return (
    <XStack bg="background" minH="100vh" flexDirection={media.md ? "row" : "column"}>
      <YStack flex={1} p="5" gap="8" items="flex-start">
        <Wordmark />
        <YStack gap="4">
          <H2 fontFamily="story" fontSize="4xl" lineHeight="4xl" fontWeight="600">
            Write it together, one turn at a time.
          </H2>
          <Paragraph fontFamily="story" fontSize="lg" lineHeight="lg" opacity={0.7}>
            One person starts a story. Everyone else adds a passage when it&apos;s their turn.
          </Paragraph>
        </YStack>
      </YStack>
      <YStack flex={1} bg="base-200" p="5" py="10" justify="center">
        <Form onSubmit={start} gap="4" maxW="96" w="100%">
          <H2 fontFamily="story" fontSize="3xl" lineHeight="3xl" fontWeight="600">
            Start a story
          </H2>
          <YStack gap="2">
            <Label htmlFor={nameId}>Your name</Label>
            <Input
              id={nameId}
              size="xl"
              value={name}
              autoComplete="nickname"
              onChangeText={setName}
            />
          </YStack>
          <YStack gap="2">
            <Label htmlFor={openingId}>Opening passage</Label>
            <TextArea
              id={openingId}
              size="xl"
              numberOfLines={3}
              value={opening}
              onChangeText={setOpening}
            />
            <Paragraph color={tooLong ? "error" : "muted"}>
              {length} / {MAX_PASSAGE_LENGTH}
              {tooLong ? " (too long)" : ""}
            </Paragraph>
          </YStack>
          <Form.Trigger asChild>
            <Button size="xl" bg="primary" color="primary-content" disabled={!canSubmit}>
              {submitting ? "Sending…" : "Start the story"}
            </Button>
          </Form.Trigger>
          <Paragraph role="alert" minH="6" color="error">
            {error}
          </Paragraph>
        </Form>
      </YStack>
    </XStack>
  );
}
