import { useSyncExternalStore } from "react";

// Whether any request has been answered `client_outdated`. It lives outside React because
// `call` in api.ts, which has no component to report to, sets it.
let outdated = false;
const listeners = new Set<() => void>();

export function setClientOutdated(value: boolean): void {
  outdated = value;
  for (const listener of listeners) {
    listener();
  }
}

export function getClientOutdated(): boolean {
  return outdated;
}

export function subscribeClientOutdated(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** True once the Worker has refused this build's API level; the app then shows the update screen. */
export function useClientOutdated(): boolean {
  return useSyncExternalStore(subscribeClientOutdated, getClientOutdated);
}
