import { useSyncExternalStore } from "react";
import { z } from "zod";

import { normaliseStoryId } from "../shared/validation";

export type Route =
  | { type: "new_story" }
  | { type: "story"; storyId: string }
  | { type: "unknown_page" };

/** The page for a URL path: `/` starts a story, `/<id>` shows one. IDs are case-insensitive. */
export function parseRoute(pathname: string): Route {
  if (pathname === "/") {
    return { type: "new_story" };
  }

  const storyId = normaliseStoryId(pathname.replace(/^\//, "").replace(/\/$/, ""));

  return storyId === null ? { type: "unknown_page" } : { type: "story", storyId };
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, currentPath);

  return parseRoute(pathname);
}

export function navigate(path: string, state: unknown = null): void {
  window.history.pushState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const leftStoryStateSchema = z.object({ leftStory: z.literal(true) });

/** Goes home with a note that the writer just left a story, which the home page shows once. */
export function navigateHomeAfterLeaving(): void {
  navigate("/", { leftStory: true });
}

/** Whether this history entry was reached by `navigateHomeAfterLeaving`. */
export function justLeftStory(): boolean {
  return leftStoryStateSchema.safeParse(window.history.state).success;
}

/** Drops the note, so reloading the page does not show it again. */
export function clearJustLeftStory(): void {
  window.history.replaceState(null, "");
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);

  return () => {
    window.removeEventListener("popstate", onChange);
  };
}

function currentPath(): string {
  return window.location.pathname;
}
