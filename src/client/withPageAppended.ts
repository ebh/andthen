import type { StorySummary } from "../shared/api";

/**
 * The list with the next page after it. A story already shown is left out of the page: the pages
 * are cut at separate moments, so a turn that changed in between can put one story on two pages,
 * and the list keys its rows by story ID.
 */
export function withPageAppended(shown: StorySummary[], page: StorySummary[]): StorySummary[] {
  const shownIds = new Set(shown.map((story) => story.id));

  return [...shown, ...page.filter((story) => !shownIds.has(story.id))];
}
