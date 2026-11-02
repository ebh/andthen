import type { SubmitEvent } from "react";
import { useId, useState } from "react";

import {
  MAX_DISPLAY_NAME_LENGTH,
  validateDisplayName,
  validatePassage,
} from "../../shared/validation";
import { createStory } from "../api";
import { Composer } from "../components/Composer";
import { describeFailure } from "../messages";
import { navigate } from "../router";

/** `/`: pick a name, write the opening passage, get a story link. */
export function NewStory() {
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <div className="flex flex-col gap-4">
      <p>Start a story, then invite others to carry it on, one passage each.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label htmlFor={nameId} className="font-semibold">
          Your name
        </label>
        <input
          id={nameId}
          className="input input-bordered w-full"
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
  );
}
