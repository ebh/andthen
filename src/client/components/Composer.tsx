import type { SubmitEvent } from "react";
import { useId } from "react";

import { MAX_PASSAGE_LENGTH, passageLength, validatePassage } from "../../shared/validation";

interface ComposerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}

/** A passage editor with a live grapheme counter. The parent owns the text so it survives a failed submit. */
export function Composer({
  label,
  value,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
}: ComposerProps) {
  const fieldId = useId();
  const counterId = useId();
  const length = passageLength(value);
  const tooLong = length > MAX_PASSAGE_LENGTH;
  const canSubmit = validatePassage(value).ok && !submitting;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="font-semibold">
        {label}
      </label>
      <textarea
        id={fieldId}
        className={`textarea textarea-bordered w-full ${tooLong ? "textarea-error" : ""}`}
        rows={4}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-describedby={counterId}
        aria-invalid={tooLong}
      />
      <div className="flex items-center justify-between gap-2">
        <span id={counterId} className={tooLong ? "text-error" : "opacity-70"}>
          {length} / {MAX_PASSAGE_LENGTH}
          {tooLong ? " (too long)" : ""}
        </span>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {submitting ? "Sending…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
