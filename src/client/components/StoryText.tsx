import type { ContributionView } from "../../shared/api";

interface StoryTextProps {
  contributions: readonly ContributionView[];
}

/** The passages so far, oldest first, each with its author. Text is rendered as plain text. */
export function StoryText({ contributions }: StoryTextProps) {
  return (
    <section aria-label="The story so far" className="flex flex-col gap-4">
      {contributions.map((contribution) => (
        <p key={contribution.id} className="whitespace-pre-wrap text-lg leading-relaxed">
          {contribution.text}{" "}
          <span className="badge badge-ghost badge-sm align-middle">{contribution.authorName}</span>
        </p>
      ))}
    </section>
  );
}
