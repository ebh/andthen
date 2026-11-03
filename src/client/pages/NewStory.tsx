import type { SubmitEvent } from "react";
import { useEffect, useId, useState } from "react";

import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PASSAGE_LENGTH,
  validateDisplayName,
  validatePassage,
} from "../../shared/validation";
import { createStory } from "../api";
import { Composer } from "../components/Composer";
import { MyStories } from "../components/MyStories";
import { Wordmark } from "../components/Wordmark";
import { describeFailure } from "../messages";
import { clearJustLeftStory, justLeftStory, navigate } from "../router";
import { useMyStories } from "../useMyStories";

/** `/`: pick a name, write the opening passage, get a story link. */
export function NewStory() {
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { load: stories, reload } = useMyStories();
  const [leftAStory] = useState(justLeftStory);
  const hasStories = stories.type === "loaded" && stories.stories.length > 0;

  useEffect(() => {
    if (leftAStory) {
      clearJustLeftStory();
    }
  }, [leftAStory]);

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
    if (!checkedOpening.ok) {
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
        navigate(`/${result.value.storyId}`);
        return;
      }
      setSubmitting(false);
      setError(describeFailure(result.failure));
    })();
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    start();
  };

  return (
    <div className="min-h-screen md:grid md:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col p-5 md:px-16 md:py-12">
        <Wordmark />
        {leftAStory && (
          <p role="status" className="mt-8 text-base-content/70">
            You left the story.
          </p>
        )}
        {stories.type === "loaded" &&
          (stories.stories.length === 0 ? <Pitch /> : <MyStories stories={stories.stories} />)}
        {stories.type === "failed" && (
          <div role="alert" className="alert alert-warning alert-vertical sm:alert-horizontal mt-8">
            Couldn't load your stories.
            <button type="button" className="btn min-h-11" onClick={reload}>
              Retry
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center bg-base-200 p-5 py-10 md:p-16">
        <div className="flex w-full max-w-md flex-col gap-4">
          <h2 className="font-story text-3xl font-semibold tracking-tight">
            {hasStories ? "Start a new story" : "Start a story"}
          </h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <label htmlFor={nameId} className="text-sm font-semibold">
              Your name
            </label>
            <input
              id={nameId}
              className="input h-11 w-full"
              value={name}
              autoComplete="nickname"
              aria-describedby={error === null ? undefined : errorId}
              aria-invalid={error !== null}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </form>
          <Composer
            label="Opening passage"
            value={opening}
            onChange={setOpening}
            onSubmit={start}
            submitting={submitting}
            submitLabel="Start the story"
          />
          <p id={errorId} role="alert" className="min-h-6 text-error">
            {error}
          </p>
        </div>
      </div>
    </div>
  );
}

function Pitch() {
  return (
    <>
      <div className="mt-10 md:mt-28">
        <h2 className="font-story text-4xl leading-tight font-semibold tracking-tight md:text-6xl md:leading-[1.04]">
          Write it together, one turn at a time.
        </h2>
        <p className="mt-5 max-w-md font-story text-lg text-base-content/70 md:text-xl">
          One person starts a story. Everyone else adds a passage when it’s their turn.
        </p>
      </div>
      <ol
        aria-label="How it works"
        className="mt-14 hidden border-t border-base-300 text-sm md:block"
      >
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.name} className="flex gap-5 border-b border-base-300 py-3.5">
            <span className="w-4 font-semibold text-primary">{index + 1}</span>
            <span className="text-base-content/70">
              <strong className="text-base-content">{step.name}</strong> {step.rest}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

const HOW_IT_WORKS = [
  { name: "Start", rest: "with an opening passage" },
  { name: "Invite", rest: "friends with a link" },
  { name: "Take turns,", rest: `up to ${MAX_PASSAGE_LENGTH.toString()} characters each` },
];
