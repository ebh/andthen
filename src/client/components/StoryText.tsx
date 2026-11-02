import { useState } from "react";

import type { ContributionView } from "../../shared/api";

interface StoryTextProps {
  contributions: readonly ContributionView[];
}

/**
 * The passages so far, oldest first. Authors are there for accountability, not reading, so they
 * stay out of the prose: in a margin beside each passage on wide screens, and behind a toggle on
 * narrow ones, where there is no room for a margin. Text is rendered as plain text.
 */
export function StoryText({ contributions }: StoryTextProps) {
  const [showAuthors, setShowAuthors] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-11 items-center gap-3 self-end text-sm text-base-content/70 md:hidden">
        <input
          type="checkbox"
          className="toggle toggle-sm toggle-primary"
          checked={showAuthors}
          onChange={(event) => {
            setShowAuthors(event.target.checked);
          }}
        />
        Show authors
      </label>
      <section aria-label="The story so far" className="flex flex-col gap-8">
        {contributions.map((contribution) => (
          <div
            key={contribution.id}
            className="flex flex-col-reverse md:grid md:grid-cols-[minmax(0,38.75rem)_minmax(0,1fr)] md:items-start md:gap-x-8"
          >
            <p className="font-story text-xl leading-relaxed whitespace-pre-wrap md:text-[1.5625rem] md:leading-relaxed">
              {contribution.text}
            </p>
            <p
              className={`${showAuthors ? "mb-1.5" : "hidden"} text-xs font-semibold tracking-wider text-base-content/70 uppercase md:mt-3.5 md:mb-0 md:block md:border-t md:border-base-300 md:pt-2.5 md:text-[0.8125rem]`}
            >
              {contribution.authorName}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
