import { useId, useState } from "react";
import { Button, Form, H2, Input, Label, Paragraph, YStack } from "tamagui";

import { joinStory } from "../client/api";
import { describeFailure } from "../client/messages";
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PARTICIPANTS,
  validateDisplayName,
} from "../shared/validation";

interface JoinFormProps {
  storyId: string;
  /** Called after the server accepts the join, or says this browser already joined. */
  onJoined: () => void;
}

/** What a browser that hasn't joined sees: no story text, only a name field. */
export function JoinForm({ storyId, onJoined }: JoinFormProps) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [full, setFull] = useState(false);

  const join = (): void => {
    const checked = validateDisplayName(name);
    if (!checked.ok) {
      setError(NAME_PROBLEM[checked.reason]);
      return;
    }

    setSubmitting(true);
    setError(null);
    void (async () => {
      const result = await joinStory(storyId, { displayName: checked.value });
      setSubmitting(false);
      if (
        result.ok ||
        (result.failure.type === "rejected" && result.failure.code === "already_joined")
      ) {
        onJoined();
        return;
      }
      // A full story stays full: retrying would only fail again.
      setFull(result.failure.type === "rejected" && result.failure.code === "story_full");
      setError(describeFailure(result.failure, FAILURE_MESSAGES));
    })();
  };

  return (
    <Form
      onSubmit={join}
      gap="3"
      w="100%"
      p="6"
      theme="level2"
      bg="background"
      rounded="lg"
      borderWidth={1}
      borderColor="border-color"
    >
      <H2 fontFamily="story" fontSize="2xl" lineHeight="2xl" fontWeight="600">
        Join this story
      </H2>
      <Paragraph>Pick a name. Others will see it next to your passages.</Paragraph>
      <YStack gap="2">
        <Label htmlFor={nameId}>Your name</Label>
        <Input id={nameId} size="xl" autoComplete="nickname" value={name} onChangeText={setName} />
      </YStack>
      <Form.Trigger asChild>
        <Button size="xl" theme="brand" disabled={submitting || full}>
          {submitting ? "Joining…" : "Join"}
        </Button>
      </Form.Trigger>
      <Paragraph role="alert" minH="6" color="error">
        {error}
      </Paragraph>
    </Form>
  );
}

const NAME_PROBLEM = {
  empty: "Enter a name.",
  too_long: `Names can be at most ${MAX_DISPLAY_NAME_LENGTH.toString()} characters.`,
};

const FAILURE_MESSAGES = {
  story_full: `This story is full (${MAX_PARTICIPANTS.toString()} writers).`,
  name_taken: "Someone in this story already uses that name. Pick another.",
  invalid_display_name: NAME_PROBLEM.too_long,
};
