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
  send: (text: string) => void;
  close: () => void;
}

export interface LiveDeps {
  openSocket: (url: string, handlers: SocketHandlers) => LiveSocket;
  setTimer: (callback: () => void, delayMs: number) => unknown;
  clearTimer: (timer: unknown) => void;
  /** A number in [0, 1), as `Math.random`. */
  random: () => number;
  /** The clock, in epoch milliseconds. */
  now: () => number;
}

export interface LiveConnection {
  url: string;
  /** Called on every open (so a change missed while disconnected is caught) and on every valid message. */
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
 * called. Messages that aren't a valid live message are ignored: a refetch is the only effect
 * a message has, so a bad one has nothing to act on.
 *
 * The backoff restarts only once a connection proves itself: it stays open for STABLE_AFTER_MS
 * or delivers a live message. A missing pong marks the socket dead and reconnects.
 */
export function keepSocketOpen(connection: LiveConnection, deps: LiveDeps): () => void {
  let stopped = false;
  let failedAttempts = 0;
  let current: LiveSocket | null = null;
  // Handlers of a socket we already gave up on must not act on the new one.
  let generation = 0;
  let retryTimer: unknown = null;
  let stableTimer: unknown = null;
  let heartbeatTimer: unknown = null;

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
        } else if (isLiveMessage(data)) {
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
export function refetchWhenTurnEnds(
  endsAt: number | null,
  refetch: () => void,
  deps: Pick<LiveDeps, "setTimer" | "clearTimer" | "now">,
): () => void {
  if (endsAt === null) {
    return () => undefined;
  }

  let timer: unknown = null;
  const arm = (delayMs: number): void => {
    timer = deps.setTimer(() => {
      refetch();
      arm(TURN_END_RETRY_MS);
    }, delayMs);
  };
  arm(Math.max(0, endsAt - deps.now()) + TURN_END_MARGIN_MS);

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
