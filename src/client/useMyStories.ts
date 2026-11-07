import { useCallback, useEffect, useRef, useState } from "react";

import type { StorySummary } from "../shared/api";
import { onDeviceUserAdded } from "./account";
import { listMyStories, type ApiFailure } from "./api";

export type MyStoriesLoad =
  | { type: "loading" }
  | { type: "loaded"; stories: StorySummary[] }
  | { type: "failed"; failure: ApiFailure };

const LOADING: MyStoriesLoad = { type: "loading" };

/** Loads the stories this browser is in when the page mounts, and again on `reload`. */
export function useMyStories(): { load: MyStoriesLoad; reload: () => void } {
  const [load, setLoad] = useState<MyStoriesLoad>(LOADING);
  const latestRequest = useRef<object>({});

  const fetchStories = useCallback(() => {
    const thisRequest = {};
    latestRequest.current = thisRequest;

    void (async () => {
      const result = await listMyStories();
      // A reply that a newer request has overtaken is dropped.
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
  }, [fetchStories]);

  // Joining an account can add stories from its other devices. Refetched in place, so a list on
  // screen doesn't flash back to loading.
  useEffect(() => onDeviceUserAdded(fetchStories), [fetchStories]);

  const reload = (): void => {
    setLoad(LOADING);
    fetchStories();
  };

  return { load, reload };
}
