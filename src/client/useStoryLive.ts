import { useEffect, useEffectEvent } from "react";

import {
  keepSocketOpen,
  liveUrl,
  refetchWhenTurnEnds,
  type LiveDeps,
  type SocketHandlers,
} from "./live";

interface StoryLiveOptions {
  storyId: string;
  /** When the current turn ends, in epoch ms; null while the story waits for a joiner. */
  endsAt: number | null;
  /** Reloads the story. Called on connect, on every live message and when the turn ends. */
  refetch: () => void;
}

/** Refetches the story whenever it may have changed: a push from the server, a reconnect, or a turn timing out. */
export function useStoryLive({ storyId, endsAt, refetch }: StoryLiveOptions): void {
  // The latest callback without re-running the effects (and reconnecting) on every render.
  const refetchLatest = useEffectEvent(refetch);

  useEffect(
    () =>
      keepSocketOpen(
        { url: liveUrl(window.location, storyId), refetch: refetchLatest },
        browserDeps,
      ),
    [storyId],
  );

  useEffect(() => refetchWhenTurnEnds(endsAt, Date.now(), refetchLatest, browserDeps), [endsAt]);
}

const browserDeps: LiveDeps = {
  openSocket,
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => {
    if (typeof timer === "number") {
      clearTimeout(timer);
    }
  },
  random: () => Math.random(),
};

function openSocket(url: string, handlers: SocketHandlers): { close: () => void } {
  const socket = new WebSocket(url);
  socket.addEventListener("open", handlers.onOpen);
  socket.addEventListener("message", (event) => {
    handlers.onMessage(event.data);
  });
  socket.addEventListener("close", handlers.onClose);

  return {
    close: () => {
      socket.close();
    },
  };
}
