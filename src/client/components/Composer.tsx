import type { Ref, SubmitEvent } from "react";
import { useId } from "react";

import { MAX_PASSAGE_LENGTH, passageLength, validatePassage } from "../../shared/validation";

interface ComposerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  /** Lets the parent move focus into the field, e.g. after filling it. */
  fieldRef?: Ref<HTMLTextAreaElement>;
  /** Shows the "New paragraph" checkbox. Left out, the passage is not a choice of the writer's. */
  newParagraph?: { checked: boolean; onChange: (checked: boolean) => void };
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
      <label htmlFor={fieldId} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={fieldId}
        ref={fieldRef}
        className={`textarea w-full rounded-lg border-2 px-4 py-3.5 font-story text-xl leading-relaxed md:text-[1.5625rem] md:leading-relaxed ${tooLong ? "textarea-error border-error" : "border-primary"}`}
        rows={3}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-describedby={counterId}
        aria-invalid={tooLong}
      />
      {newParagraph && (
        <label className="flex min-h-11 items-center gap-3 self-start text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm checkbox-primary"
            checked={newParagraph.checked}
            onChange={(event) => {
              newParagraph.onChange(event.target.checked);
            }}
          />
          New paragraph
        </label>
      )}
      <div className="flex items-center justify-between gap-2">
        <span
          id={counterId}
          className={`text-sm ${tooLong ? "text-error" : "text-base-content/70"}`}
        >
          {length} / {MAX_PASSAGE_LENGTH}
          {tooLong ? " (too long)" : ""}
        </span>
        <button type="submit" className="btn btn-primary min-h-11" disabled={!canSubmit}>
          {submitting ? "Sending…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
