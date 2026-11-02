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
