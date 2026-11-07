// Browser-free so it runs under Node tests: the hook in useStoryLive.ts supplies the real
// WebSocket, timers and clock.

import { liveSubprotocolsFor } from "../shared/liveSubprotocol";

export interface SocketHandlers {
  onOpen: () => void;
  /** The raw payload; the controller parses it. */
  onMessage: (data: unknown) => void;
  /** Fires for a failed open too, since a refused upgrade never opens. */
  onClose: () => void;
}

export interface LiveSocket {
  send: (text: string) => void;
  close: () => void;
}

/** `Timer` is whatever `setTimer` hands back; the caller picks it so `clearTimer` needs no guess about its type. */
export interface LiveDeps<Timer = unknown> {
  openSocket: (url: string, handlers: SocketHandlers) => LiveSocket;
  setTimer: (callback: () => void, delayMs: number) => Timer;
  clearTimer: (timer: Timer) => void;
  /** A number in [0, 1), as `Math.random`. */
  random: () => number;
  /** The clock, in epoch milliseconds. */
  now: () => number;
}

export interface LiveConnection {
  url: string;
  /** Called on every open (so a change missed while disconnected is caught) and on every JSON message. */
  refetch: () => void;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;

// A socket that closes sooner than this after opening doesn't count as a working connection, so
// a server that accepts and then drops us can't keep the retries at the shortest delay.
const STABLE_AFTER_MS = 10_000;

// The runtime answers "ping" with "pong" without waking the room, so this keeps the socket
// honest at no cost; a silent half-open connection would otherwise never trigger a close.
const HEARTBEAT_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const PING = "ping";
const PONG = "pong";

/**
 * Keeps one socket open to `url`, reconnecting with backoff until the returned function is
 * called. Any message that is JSON text triggers a refetch, whatever its shape: the only effect a
 * message has is a refetch, and a message kind from a newer Worker still means "something
 * changed". Text that isn't JSON and binary frames are ignored.
 *
 * The backoff restarts only once a connection proves itself: it stays open for STABLE_AFTER_MS
 * or delivers a live message. A missing pong marks the socket dead and reconnects.
 */
export function keepSocketOpen<Timer>(
  connection: LiveConnection,
  deps: LiveDeps<Timer>,
): () => void {
  let stopped = false;
  let failedAttempts = 0;
  let current: LiveSocket | null = null;
  // Handlers of a socket we already gave up on must not act on the new one.
  let generation = 0;
  let retryTimer: Timer | null = null;
  let stableTimer: Timer | null = null;
  let heartbeatTimer: Timer | null = null;

  const clearHeartbeat = (): void => {
    if (heartbeatTimer !== null) {
      deps.clearTimer(heartbeatTimer);
    }
    heartbeatTimer = null;
  };

  const clearConnectionTimers = (): void => {
    clearHeartbeat();
    if (stableTimer !== null) {
      deps.clearTimer(stableTimer);
    }
    stableTimer = null;
  };

  const scheduleHeartbeat = (socket: LiveSocket): void => {
    heartbeatTimer = deps.setTimer(() => {
      socket.send(PING);
      heartbeatTimer = deps.setTimer(connectionLost, PONG_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  };

  const connectionLost = (): void => {
    if (stopped) {
      return;
    }
    generation += 1;
    clearConnectionTimers();
    current?.close();
    current = null;
    retryTimer = deps.setTimer(connect, backoffDelayMs(failedAttempts, deps.random()));
    failedAttempts += 1;
  };

  const connect = (): void => {
    retryTimer = null;
    const mine = generation;
    const isCurrent = (): boolean => mine === generation && !stopped;
    current = deps.openSocket(connection.url, {
      onOpen: () => {
        if (!isCurrent() || current === null) {
          return;
        }
        stableTimer = deps.setTimer(() => {
          failedAttempts = 0;
        }, STABLE_AFTER_MS);
        scheduleHeartbeat(current);
        connection.refetch();
      },
      onMessage: (data) => {
        if (!isCurrent() || current === null) {
          return;
        }
        if (data === PONG) {
          clearHeartbeat();
          scheduleHeartbeat(current);
        } else if (isJsonText(data)) {
          failedAttempts = 0;
          connection.refetch();
        }
      },
      onClose: () => {
        if (isCurrent()) {
          connectionLost();
        }
      },
    });
  };

  connect();

  return () => {
    stopped = true;
    generation += 1;
    clearConnectionTimers();
    if (retryTimer !== null) {
      deps.clearTimer(retryTimer);
    }
    current?.close();
  };
}

/** Delay before reconnect number `failedAttempts + 1`: doubling, capped, with jitter so clients spread out. */
export function backoffDelayMs(failedAttempts: number, random: number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** failedAttempts);

  return Math.round(ceiling * (0.5 + random / 2));
}

/** Opens the real socket, offering `protocols` (the live subprotocol, then any session token). */
export type SocketFactory = (
  url: string,
  protocols: string[],
  handlers: SocketHandlers,
) => LiveSocket;

/**
 * A socket that opens once the session token is known, so the caller gets its `LiveSocket` at once.
 * The token is fetched per connection: a reconnect an hour later must not offer an expired one.
 * Closing before the token arrives opens nothing.
 */
export function openSocketWithSession(
  url: string,
  handlers: SocketHandlers,
  getToken: () => Promise<string | null>,
  createSocket: SocketFactory,
): LiveSocket {
  const state: { socket: LiveSocket | null; closed: boolean } = { socket: null, closed: false };

  void (async () => {
    const token = await getToken();
    if (!state.closed) {
      state.socket = createSocket(url, liveSubprotocolsFor(token), handlers);
    }
  })();

  return {
    send: (text) => {
      state.socket?.send(text);
    },
    close: () => {
      state.closed = true;
      state.socket?.close();
    },
  };
}

/** The WebSocket URL for a story on the page's own host. */
export function liveUrl(page: { protocol: string; host: string }, storyId: string): string {
  const scheme = page.protocol === "https:" ? "wss" : "ws";

  return `${scheme}://${page.host}/api/stories/${storyId}/live`;
}

// The server decides when a turn has ended, by its own clock. This leaves room for a little
// skew; refetchWhenTurnEnds covers a client clock that runs further ahead.
const TURN_END_MARGIN_MS = 1000;

// The shortest wait between refetches while the turn the page shows has not changed.
const TURN_END_RETRY_MS = 5000;

/**
 * Calls `refetch` once the turn ends, since no message arrives when a turn simply times out.
 * A null `endsAt` (a waiting story) schedules nothing.
 *
 * The client clock may run ahead of the server's, so the refetch can come back with the same
 * turn still running. Nothing re-arms the timer then (the page's `endsAt` didn't change), so it
 * re-arms itself every TURN_END_RETRY_MS until cancelled. The caller cancels it when `endsAt`
 * changes, which is when the refetch has seen the turn move on.
 *
 * Returns a function that cancels it.
 */
export function refetchWhenTurnEnds<Timer>(
  endsAt: number | null,
  refetch: () => void,
  deps: Pick<LiveDeps<Timer>, "setTimer" | "clearTimer" | "now">,
): () => void {
  if (endsAt === null) {
    return () => undefined;
  }

  let timer: Timer | null = null;
  const arm = (delayMs: number): void => {
    timer = deps.setTimer(() => {
      refetch();
      arm(TURN_END_RETRY_MS);
    }, delayMs);
  };
  arm(Math.max(0, endsAt - deps.now()) + TURN_END_MARGIN_MS);

  return () => {
    if (timer !== null) {
      deps.clearTimer(timer);
    }
  };
}

function isJsonText(data: unknown): boolean {
  if (typeof data !== "string") {
    return false;
  }

  try {
    JSON.parse(data);

    return true;
  } catch {
    return false;
  }
}
