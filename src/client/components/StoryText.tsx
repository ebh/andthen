import type { ContributionView } from "../../shared/api";

interface StoryTextProps {
  contributions: readonly ContributionView[];
}

/**
 * The passages so far, oldest first. The author sits on its own quiet line under each passage so
 * the prose reads unbroken. Text is rendered as plain text.
 */
export function StoryText({ contributions }: StoryTextProps) {
  return (
    <section aria-label="The story so far" className="flex flex-col gap-8">
      {contributions.map((contribution) => (
        <div key={contribution.id}>
          <p className="font-story text-lg leading-relaxed whitespace-pre-wrap sm:text-xl sm:leading-relaxed">
            {contribution.text}
          </p>
          <p className="mt-1 text-right text-sm text-base-content/70">{contribution.authorName}</p>
        </div>
      ))}
    </section>
  );
}
