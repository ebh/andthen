import { liveMessageSchema } from "../shared/api";

// Browser-free so it runs under Node tests: the hook in useStoryLive.ts supplies the real
// WebSocket, timers and clock.

export interface SocketHandlers {
  onOpen: () => void;
  /** The raw payload; the controller parses it. */
  onMessage: (data: unknown) => void;
  /** Fires for a failed open too, since a refused upgrade never opens. */
  onClose: () => void;
}

export interface LiveSocket {
  close: () => void;
}

export interface LiveDeps {
  openSocket: (url: string, handlers: SocketHandlers) => LiveSocket;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
  /** A number in [0, 1), as `Math.random`. */
  random: () => number;
}

export interface LiveConnection {
  url: string;
  /** Called on every open (so a change missed while disconnected is caught) and on every valid message. */
  refetch: () => void;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

/**
 * Keeps one socket open to `url`, reconnecting with backoff until the returned function is
 * called. Messages that aren't a valid live message are ignored: a refetch is the only effect
 * a message has, so a bad one has nothing to act on.
 */
export function keepSocketOpen(connection: LiveConnection, deps: LiveDeps): () => void {
  let stopped = false;
  let failedAttempts = 0;
  let socket: LiveSocket | null = null;
  let retryTimer: unknown = null;

  const connect = (): void => {
    retryTimer = null;
    socket = deps.openSocket(connection.url, {
      onOpen: () => {
        failedAttempts = 0;
        connection.refetch();
      },
      onMessage: (data) => {
        if (isLiveMessage(data)) {
          connection.refetch();
        }
      },
      onClose: () => {
        if (stopped) {
          return;
        }
        retryTimer = deps.setTimer(connect, backoffDelayMs(failedAttempts, deps.random()));
        failedAttempts += 1;
      },
    });
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer !== null) {
      deps.clearTimer(retryTimer);
    }
    socket?.close();
  };
}

/** Delay before reconnect number `failedAttempts + 1`: doubling, capped, with jitter so clients spread out. */
export function backoffDelayMs(failedAttempts: number, random: number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** failedAttempts);

  return Math.round(ceiling * (0.5 + random / 2));
}

/** The WebSocket URL for a story on the page's own host. */
export function liveUrl(page: { protocol: string; host: string }, storyId: string): string {
  const scheme = page.protocol === "https:" ? "wss" : "ws";

  return `${scheme}://${page.host}/api/stories/${storyId}/live`;
}

// The server computes turn expiry when it reads, so the timer must not fire before `endsAt` by
// the server's clock; a little late is harmless.
const TURN_END_MARGIN_MS = 1000;

/**
 * Calls `refetch` once the turn ends, since no message arrives when a turn simply times out.
 * A null `endsAt` (a waiting story) schedules nothing. Returns a function that cancels it.
 */
export function refetchWhenTurnEnds(
  endsAt: number | null,
  now: number,
  refetch: () => void,
  deps: Pick<LiveDeps, "setTimer" | "clearTimer">,
): () => void {
  if (endsAt === null) {
    return () => undefined;
  }

  const timer = deps.setTimer(refetch, Math.max(0, endsAt - now) + TURN_END_MARGIN_MS);

  return () => {
    deps.clearTimer(timer);
  };
}

function isLiveMessage(data: unknown): boolean {
  if (typeof data !== "string") {
    return false;
  }

  try {
    return liveMessageSchema.safeParse(JSON.parse(data)).success;
  } catch {
    return false;
  }
}
