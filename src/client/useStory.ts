import { useCallback, useEffect, useState } from "react";

import type { StoryView } from "../shared/api";
import { fetchStory, type ApiFailure, type ApiResult } from "./api";
import { createLatestRequest } from "./latestRequest";

export type StoryLoad =
  | { type: "loading" }
  | { type: "loaded"; view: StoryView; refreshFailed: boolean }
  // The story exists but this browser hasn't joined it.
  | { type: "not_joined" }
  | { type: "not_found" }
  // This browser was in the story and left it.
  | { type: "left"; displayName: string; opening: string }
  | { type: "failed"; failure: ApiFailure };

const LOADING: StoryLoad = { type: "loading" };

/**
 * Loads a story and reloads it on demand. A reply that a newer request has overtaken is dropped.
 * Mount it with `key={storyId}`: it starts from loading and does not reset when the ID changes.
 */
export function useStory(storyId: string): { load: StoryLoad; refetch: () => void } {
  const [load, setLoad] = useState<StoryLoad>(LOADING);
  const [latest] = useState(createLatestRequest);

  const refetch = useCallback(() => {
    const isLatest = latest.start();

    void (async () => {
      const result = await fetchStory(storyId);
      if (isLatest()) {
        setLoad((previous) => nextLoad(previous, result));
      }
    })();
  }, [latest, storyId]);

  useEffect(() => {
    refetch();

    return () => {
      // Drops the reply of a request still in flight.
      latest.cancel();
    };
  }, [latest, refetch]);

  return { load, refetch };
}

export function nextLoad(previous: StoryLoad, result: ApiResult<StoryView>): StoryLoad {
  if (result.ok) {
    return { type: "loaded", view: result.value, refreshFailed: false };
  }

  const { failure } = result;
  if (failure.type === "rejected" && failure.code === "not_participant") {
    return { type: "not_joined" };
  }
  if (failure.type === "rejected" && failure.code === "not_found") {
    return { type: "not_found" };
  }
  // Checked before the reload rule below: a writer who left in another tab gets the way back in.
  if (failure.type === "left_story") {
    return { type: "left", displayName: failure.displayName, opening: failure.opening };
  }
  // A failed reload keeps the story on screen: the live socket retries on its own.
  if (previous.type === "loaded") {
    return { ...previous, refreshFailed: true };
  }

  return { type: "failed", failure };
}
