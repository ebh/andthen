import { useState } from "react";
import { Button, Form, H2, Paragraph } from "tamagui";

import { joinStory } from "../client/api";
import { NAME_FAILURE_MESSAGES, describeFailure, describeNameProblem } from "../client/messages";
import { nameIsSettled, nameStep, nameToSend, nameWasStale } from "../client/userName";
import { useUserName } from "../client/useUserName";
import { MAX_PARTICIPANTS } from "../shared/validation";
import { NameField } from "./NameField";

interface JoinFormProps {
  storyId: string;
  /** Called after the server accepts the join, or says this browser already joined. */
  onJoined: () => void;
}

/**
 * What a browser that hasn't joined sees: no story text, only a join button, with a name field
 * while the user has no name.
 */
export function JoinForm({ storyId, onJoined }: JoinFormProps) {
  const { load, reload } = useUserName();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [full, setFull] = useState(false);
  const step = nameStep(load);

  const join = (): void => {
    const toSend = nameToSend(load, name);
    if (!toSend.ok) {
      setError(describeNameProblem(toSend.problem));
      return;
    }

    setSubmitting(true);
    setError(null);
    void (async () => {
      const result = await joinStory(storyId, toSend.request);
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
      if (nameWasStale(result.failure)) {
        reload();
      }
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
      {step === "ask" && (
        <Paragraph>Pick a name. Others will see it next to your passages.</Paragraph>
      )}
      <NameField load={load} reload={reload} value={name} onChange={setName} />
      <Form.Trigger asChild>
        <Button size="xl" theme="brand" disabled={submitting || full || !nameIsSettled(load)}>
          {submitting ? "Joining…" : "Join"}
        </Button>
      </Form.Trigger>
      <Paragraph role="alert" minH="6" color="error">
        {error}
      </Paragraph>
    </Form>
  );
}

const FAILURE_MESSAGES = {
  ...NAME_FAILURE_MESSAGES,
  story_full: `This story is full (${MAX_PARTICIPANTS.toString()} writers).`,
};
