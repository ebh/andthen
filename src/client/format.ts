import type { StorySummary } from "../shared/api";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** "23h 59m left", "12m left", or "less than a minute left"; "ending now" once `endsAt` has passed. */
export function describeTimeLeft(endsAt: number, now: number): string {
  const left = endsAt - now;
  if (left <= 0) {
    return "ending now";
  }
  if (left < MINUTE_MS) {
    return "less than a minute left";
  }

  const hours = Math.floor(left / HOUR_MS);
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS);

  return hours > 0
    ? `${hours.toString()}h ${minutes.toString()}m left`
    : `${minutes.toString()}m left`;
}

/** The status line under a story in the list: whose turn it is, with time left or writer count. */
export function describeStatus(story: StorySummary, now: number): string {
  if (story.holderName === null || story.endsAt === null) {
    return "Waiting for someone to join";
  }
  if (story.isMyTurn) {
    return `Your turn · ${describeTimeLeft(story.endsAt, now)}`;
  }

  return `${story.holderName}’s turn · ${story.writerCount.toString()} writers`;
}
