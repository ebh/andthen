/**
 * Keeps track of which request is the latest, so a reply that a newer request has overtaken can
 * be dropped. Each request holds the `() => boolean` it was given and asks it before applying its
 * reply.
 */

export interface LatestRequest {
  /** Begins a request that overtakes every older one. Returns whether it is still the latest. */
  start(): () => boolean;
  /** Ties to the current request without overtaking anything; a later start() overtakes it. */
  join(): () => boolean;
  /** Every request in flight stops being current. */
  cancel(): void;
}

export function createLatestRequest(): LatestRequest {
  let latest: object = {};

  return {
    start() {
      const token = {};
      latest = token;

      return () => token === latest;
    },
    join() {
      const token = latest;

      return () => token === latest;
    },
    cancel() {
      latest = {};
    },
  };
}
