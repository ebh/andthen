import { useEffect, useEffectEvent } from "react";

import {
  keepSocketOpen,
  liveUrl,
  openSocketWithSession,
  refetchWhenTurnEnds,
  type LiveDeps,
  type LiveSocket,
  type SocketHandlers,
} from "./live";
import { getSessionToken } from "./sessionToken";

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

  useEffect(() => refetchWhenTurnEnds(endsAt, refetchLatest, browserDeps), [endsAt]);
}

const browserDeps: LiveDeps<ReturnType<typeof setTimeout>> = {
  openSocket: (url, handlers) =>
    openSocketWithSession(url, handlers, getSessionToken, createSocket),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => {
    clearTimeout(timer);
  },
  random: () => Math.random(),
  now: () => Date.now(),
};

function createSocket(url: string, protocols: string[], handlers: SocketHandlers): LiveSocket {
  const socket = new WebSocket(url, protocols);
  socket.addEventListener("open", handlers.onOpen);
  socket.addEventListener("message", (event) => {
    handlers.onMessage(event.data);
  });
  socket.addEventListener("close", handlers.onClose);

  return {
    send: (text) => {
      socket.send(text);
    },
    close: () => {
      socket.close();
    },
  };
}
