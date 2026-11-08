import { useCallback, useEffect, useRef, useState } from "react";

import type { StorySummary } from "../shared/api";
import { onDeviceUserAdded } from "./account";
import { listMyStories, type ApiFailure } from "./api";
import { withPageAppended } from "./withPageAppended";

export type MyStoriesLoad =
  | { type: "loading" }
  | {
      type: "loaded";
      stories: StorySummary[];
      /** Where the next page starts; null when the list is complete. */
      nextCursor: string | null;
    }
  | { type: "failed"; failure: ApiFailure };

/** How the request for the next page stands. */
export type MoreStoriesStatus = "idle" | "loading" | "failed";

const LOADING: MyStoriesLoad = { type: "loading" };

/**
 * Loads the first page of the stories this browser is in when the page mounts, and again on
 * `reload`. `loadMore` appends the next page.
 */
export function useMyStories(): {
  load: MyStoriesLoad;
  reload: () => void;
  loadMore: () => void;
  moreStatus: MoreStoriesStatus;
} {
  const [load, setLoad] = useState<MyStoriesLoad>(LOADING);
  const [moreStatus, setMoreStatus] = useState<MoreStoriesStatus>("idle");
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
            ? { type: "loaded", stories: result.value.stories, nextCursor: result.value.nextCursor }
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
  useEffect(
    () =>
      onDeviceUserAdded(() => {
        // The refetch overtakes a page in flight, which is then dropped, so nothing else would end its "loading".
        setMoreStatus("idle");
        fetchStories();
      }),
    [fetchStories],
  );

  const reload = (): void => {
    setLoad(LOADING);
    setMoreStatus("idle");
    fetchStories();
  };

  const loadMore = (): void => {
    if (load.type !== "loaded") {
      return;
    }
    const { nextCursor, stories } = load;
    if (nextCursor === null || moreStatus === "loading") {
      return;
    }

    // A first-page request that starts meanwhile replaces the list, so this page is dropped.
    const thisRequest = latestRequest.current;
    setMoreStatus("loading");
    void (async () => {
      const result = await listMyStories(nextCursor);
      if (thisRequest !== latestRequest.current) {
        return;
      }

      if (!result.ok) {
        setMoreStatus("failed");
        return;
      }

      setMoreStatus("idle");
      setLoad({
        type: "loaded",
        stories: withPageAppended(stories, result.value.stories),
        nextCursor: result.value.nextCursor,
      });
    })();
  };

  return { load, reload, loadMore, moreStatus };
}
