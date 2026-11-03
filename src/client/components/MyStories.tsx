import type { StorySummary } from "../../shared/api";
import { describeTimeLeft } from "../format";
import { useNow } from "../useNow";
import { PageLink } from "./PageLink";

interface MyStoriesProps {
  /** The stories to list, in the order to show them. */
  stories: readonly StorySummary[];
}

const CLOCK_TICK_MS = 10_000;

/** The stories this browser is in, each a link to its page, with whose turn it is. */
export function MyStories({ stories }: MyStoriesProps) {
  const now = useNow(CLOCK_TICK_MS);

  return (
    <section aria-label="Your stories" className="mt-8 md:mt-24">
      <h2 className="font-story text-3xl font-semibold tracking-tight md:text-5xl">Your stories</h2>
      <ul className="mt-6 border-t border-base-300 md:mt-10">
        {stories.map((story) => (
          <li key={story.id} className="border-b border-base-300">
            <PageLink
              to={`/${story.id}`}
              className="flex min-h-11 flex-col gap-1 py-4 hover:bg-base-200/60"
            >
              <span className="line-clamp-2 font-story text-lg leading-snug md:text-2xl">
                {story.opening}
              </span>
              <span
                className={`text-sm ${story.isMyTurn ? "font-semibold text-primary" : "text-base-content/70"}`}
              >
                {describeStatus(story, now)}
              </span>
            </PageLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function describeStatus(story: StorySummary, now: number): string {
  if (story.holderName === null || story.endsAt === null) {
    return "Waiting for someone to join";
  }
  if (story.isMyTurn) {
    return `Your turn · ${describeTimeLeft(story.endsAt, now)}`;
  }

  return `${story.holderName}’s turn · ${story.writerCount.toString()} writers`;
}
