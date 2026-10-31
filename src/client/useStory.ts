import { useCallback, useEffect, useRef, useState } from "react";

import type { StoryView } from "../shared/api";
import { fetchStory, type ApiFailure, type ApiResult } from "./api";

export type StoryLoad =
  | { type: "loading" }
  | { type: "loaded"; view: StoryView; refreshFailed: boolean }
  // The story exists but this browser hasn't joined it.
  | { type: "not_joined" }
  | { type: "not_found" }
  | { type: "failed"; failure: ApiFailure };

const LOADING: StoryLoad = { type: "loading" };

/**
 * Loads a story and reloads it on demand. A reply that a newer request has overtaken is dropped.
 * Mount it with `key={storyId}`: it starts from loading and does not reset when the ID changes.
 */
export function useStory(storyId: string): { load: StoryLoad; refetch: () => void } {
  const [load, setLoad] = useState<StoryLoad>(LOADING);
  const latestRequest = useRef(0);

  const refetch = useCallback(() => {
    latestRequest.current += 1;
    const thisRequest = latestRequest.current;

    void (async () => {
      const result = await fetchStory(storyId);
      if (thisRequest === latestRequest.current) {
        setLoad((previous) => nextLoad(previous, result));
      }
    })();
  }, [storyId]);

  useEffect(() => {
    refetch();

    return () => {
      // Drops the reply of a request still in flight.
      latestRequest.current += 1;
    };
  }, [refetch]);

  return { load, refetch };
}

function nextLoad(previous: StoryLoad, result: ApiResult<StoryView>): StoryLoad {
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
  // A failed reload keeps the story on screen: the live socket retries on its own.
  if (previous.type === "loaded") {
    return { ...previous, refreshFailed: true };
  }

  return { type: "failed", failure };
}
