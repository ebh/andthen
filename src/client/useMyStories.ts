import { useCallback, useEffect, useRef, useState } from "react";

import type { StorySummary } from "../shared/api";
import { onAccountSynced } from "./account";
import { listMyStories, type ApiFailure } from "./api";

export type MyStoriesLoad =
  | { type: "loading" }
  | { type: "loaded"; stories: StorySummary[] }
  | { type: "failed"; failure: ApiFailure };

const LOADING: MyStoriesLoad = { type: "loading" };

/** Loads the stories this browser is in when the page mounts, and again on `reload`. */
export function useMyStories(): { load: MyStoriesLoad; reload: () => void } {
  const [load, setLoad] = useState<MyStoriesLoad>(LOADING);
  const latestRequest = useRef(0);

  const fetchStories = useCallback(() => {
    latestRequest.current += 1;
    const thisRequest = latestRequest.current;

    void (async () => {
      const result = await listMyStories();
      // A reply that a newer request, or the page unmounting, has overtaken is dropped.
      if (thisRequest === latestRequest.current) {
        setLoad(
          result.ok
            ? { type: "loaded", stories: result.value.stories }
            : { type: "failed", failure: result.failure },
        );
      }
    })();
  }, []);

  useEffect(() => {
    fetchStories();

    return () => {
      latestRequest.current += 1;
    };
  }, [fetchStories]);

  // Joining an account can add stories from its other devices. Refetched in place, so a list on
  // screen doesn't flash back to loading.
  useEffect(() => onAccountSynced(fetchStories), [fetchStories]);

  const reload = (): void => {
    setLoad(LOADING);
    fetchStories();
  };

  return { load, reload };
}
