import { useRouter } from "expo-router";
import { useId, useState } from "react";
import {
  Button,
  Form,
  H2,
  Input,
  Label,
  Paragraph,
  Text,
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
import { takeLeftStoryNote } from "../client/leftStoryNote";
import { describeFailure } from "../client/messages";
import { useMyStories } from "../client/useMyStories";
import { MyStories } from "./MyStories";
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
  const { load: stories, reload } = useMyStories();
  const [leftAStory] = useState(takeLeftStoryNote);
  const hasStories = stories.type === "loaded" && stories.stories.length > 0;
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
    <XStack bg="background" grow={1} flexDirection={media.md ? "row" : "column"}>
      <YStack
        flex={media.md ? 1.1 : undefined}
        px={media.md ? "16" : "5"}
        py={media.md ? "12" : "5"}
      >
        <Wordmark />
        {leftAStory && (
          <Paragraph role="status" color="muted" mt="8">
            You left the story.
          </Paragraph>
        )}
        {stories.type === "loaded" &&
          (stories.stories.length === 0 ? (
            <Pitch />
          ) : (
            <YStack mt={media.md ? "24" : "8"}>
              <MyStories stories={stories.stories} />
            </YStack>
          ))}
        {stories.type === "failed" && (
          <YStack role="alert" mt="8" gap="3" items="flex-start">
            <Paragraph>Couldn&apos;t load your stories.</Paragraph>
            <Button size="xl" variant="outlined" onPress={reload}>
              Retry
            </Button>
          </YStack>
        )}
      </YStack>
      <YStack
        flex={media.md ? 1 : undefined}
        grow={1}
        theme="level2"
        bg="background"
        px={media.md ? "16" : "5"}
        py={media.md ? "16" : "10"}
        items="center"
        justify="center"
      >
        <Form onSubmit={start} gap="4" maxW="narrow" w="100%">
          <H2 fontFamily="story" fontSize="3xl" lineHeight="3xl" fontWeight="600">
            {hasStories ? "Start a new story" : "Start a story"}
          </H2>
          <YStack gap="2">
            <Label htmlFor={nameId}>Your name</Label>
            <Input
              id={nameId}
              size="xl"
              autoComplete="nickname"
              value={name}
              onChangeText={setName}
            />
          </YStack>
          <YStack gap="2">
            <Label htmlFor={openingId}>Opening passage</Label>
            <TextArea id={openingId} size="xl" value={opening} onChangeText={setOpening} />
          </YStack>
          <XStack flexWrap="wrap" items="center" justify="space-between" gap="2">
            <Paragraph color={tooLong ? "error" : "muted"}>
              {length} / {MAX_PASSAGE_LENGTH}
              {tooLong ? " (too long)" : ""}
            </Paragraph>
            <Form.Trigger asChild>
              <Button
                size="xl"
                theme="brand"
                disabled={!canSubmit}
                w={media.md ? undefined : "100%"}
              >
                {submitting ? "Sending…" : "Start the story"}
              </Button>
            </Form.Trigger>
          </XStack>
          <Paragraph role="alert" minH="6" color="error">
            {error}
          </Paragraph>
        </Form>
      </YStack>
    </XStack>
  );
}

function Pitch() {
  const media = useMedia();

  return (
    <YStack mt={media.md ? "28" : "10"}>
      <YStack gap="5" items="flex-start">
        <H2
          fontFamily="story"
          fontSize={media.md ? "6xl" : "4xl"}
          lineHeight={media.md ? "6xl" : "4xl"}
          fontWeight="600"
        >
          Write it together, one turn at a time.
        </H2>
        <Paragraph
          fontFamily="story"
          fontSize={media.md ? "xl" : "lg"}
          lineHeight={media.md ? "xl" : "lg"}
          color="muted"
          maxW="narrow"
        >
          One person starts a story. Everyone else adds a passage when it&apos;s their turn.
        </Paragraph>
      </YStack>
      {media.md && <HowItWorks />}
    </YStack>
  );
}

function HowItWorks() {
  return (
    <YStack
      role="list"
      aria-label="How it works"
      mt="14"
      borderTopWidth={1}
      borderColor="border-color"
    >
      {HOW_IT_WORKS.map((step, index) => (
        <XStack
          key={step.name}
          role="listitem"
          gap="5"
          py="3.5"
          borderBottomWidth={1}
          borderColor="border-color"
        >
          <Paragraph w="4" color="primary" fontWeight="600">
            {index + 1}
          </Paragraph>
          <Paragraph flex={1} color="muted">
            <Text fontWeight="600" color="color">
              {step.name}
            </Text>{" "}
            {step.rest}
          </Paragraph>
        </XStack>
      ))}
    </YStack>
  );
}

const HOW_IT_WORKS = [
  { name: "Start", rest: "with an opening passage" },
  { name: "Invite", rest: "friends with a link" },
  { name: "Take turns,", rest: `up to ${MAX_PASSAGE_LENGTH.toString()} characters each` },
];
