import { useSyncExternalStore } from "react";

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

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
