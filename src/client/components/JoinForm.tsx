import type { SubmitEvent } from "react";
import { useId, useState } from "react";

import { joinStory } from "../api";
import { describeFailure } from "../messages";
import { MAX_DISPLAY_NAME_LENGTH, validateDisplayName } from "../../shared/validation";

interface JoinFormProps {
  storyId: string;
  /** Called after the server accepts the join, or says this browser already joined. */
  onJoined: () => void;
}

/** What a browser that hasn't joined sees: no story text, only a name field. */
export function JoinForm({ storyId, onJoined }: JoinFormProps) {
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [full, setFull] = useState(false);

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
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
    <form onSubmit={handleSubmit} className="card card-border bg-base-200">
      <div className="card-body gap-3">
        <h2 className="card-title">Join this story</h2>
        <p>Pick a name. Others will see it next to your passages.</p>
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
        <p id={errorId} role="alert" className="min-h-6 text-error">
          {error}
        </p>
        <button type="submit" className="btn btn-primary" disabled={submitting || full}>
          {submitting ? "Joining…" : "Join"}
        </button>
      </div>
    </form>
  );
}

const NAME_PROBLEM = {
  empty: "Enter a name.",
  too_long: `Names can be at most ${MAX_DISPLAY_NAME_LENGTH.toString()} characters.`,
};

const FAILURE_MESSAGES = {
  story_full: "This story is full (50 writers).",
  name_taken: "Someone in this story already uses that name. Pick another.",
  invalid_display_name: NAME_PROBLEM.too_long,
};
