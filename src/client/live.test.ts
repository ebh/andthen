import { describe, expect, it } from "vitest";

import {
  backoffDelayMs,
  keepSocketOpen,
  liveUrl,
  refetchWhenTurnEnds,
  type LiveDeps,
  type SocketHandlers,
} from "./live";

interface FakeSocket {
  url: string;
  handlers: SocketHandlers;
  sent: string[];
  closed: boolean;
}

interface Timer {
  dueAt: number;
  callback: () => void;
}

interface Harness {
  deps: LiveDeps;
  sockets: FakeSocket[];
  timers: Map<number, Timer>;
  /** Moves the clock forward, firing every timer that falls due on the way, in order. */
  advance: (ms: number) => void;
  clock: () => number;
}

function harness(random = 0, startAt = 0): Harness {
  const sockets: FakeSocket[] = [];
  const timers = new Map<number, Timer>();
  let nextTimerId = 1;
  let now = startAt;

  const advance = (ms: number): void => {
    const target = now + ms;
    for (;;) {
      const due = Array.from(timers).filter(([, timer]) => timer.dueAt <= target);
      const next = due.toSorted(([, a], [, b]) => a.dueAt - b.dueAt)[0];
      if (next === undefined) {
        break;
      }
      timers.delete(next[0]);
      now = next[1].dueAt;
      next[1].callback();
    }
    now = target;
  };

  return {
    sockets,
    timers,
    advance,
    clock: () => now,
    deps: {
      openSocket: (url, handlers) => {
        const socket: FakeSocket = { url, handlers, sent: [], closed: false };
        sockets.push(socket);

        return {
          send: (text) => {
            socket.sent.push(text);
          },
          close: () => {
            socket.closed = true;
          },
        };
      },
      setTimer: (callback, delayMs) => {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, { dueAt: now + delayMs, callback });

        return id;
      },
      clearTimer: (timer) => {
        if (typeof timer === "number") {
          timers.delete(timer);
        }
      },
      random: () => random,
      now: () => now,
    },
  };
}

function start(random = 0) {
  const h = harness(random);
  let refetches = 0;
  const stop = keepSocketOpen(
    {
      url: "ws://x/live",
      refetch: () => {
        refetches += 1;
      },
    },
    h.deps,
  );

  return { h, stop, refetches: () => refetches };
}

// Closes the newest socket and returns how long the client waited before opening the next one.
function reconnectDelay(h: Harness): number {
  const before = h.sockets.length;
  h.sockets.at(-1)?.handlers.onClose();
  let waited = 0;
  while (h.sockets.length === before) {
    h.advance(1);
    waited += 1;
    if (waited > 60_000) {
      throw new Error("never reconnected");
    }
  }

  return waited;
}

describe("keepSocketOpen", () => {
  it("opens a socket on the given URL and refetches when it opens", () => {
    const { h, refetches } = start();

    expect(h.sockets.map((s) => s.url)).toEqual(["ws://x/live"]);
    expect(refetches()).toBe(0);

    h.sockets[0]?.handlers.onOpen();

    expect(refetches()).toBe(1);
  });

  it("refetches on a valid live message", () => {
    const { h, refetches } = start();

    h.sockets[0]?.handlers.onMessage(JSON.stringify({ version: 3 }));

    expect(refetches()).toBe(1);
  });

  it("ignores messages that aren't a live message", () => {
    const { h, refetches } = start();

    for (const data of [
      "not json",
      JSON.stringify({ version: "3" }),
      JSON.stringify({ version: -1 }),
      JSON.stringify({}),
      JSON.stringify(null),
      new ArrayBuffer(2),
      42,
    ]) {
      h.sockets[0]?.handlers.onMessage(data);
    }

    expect(refetches()).toBe(0);
  });

  it("reconnects after a close, and refetches again when the new socket opens", () => {
    const { h, refetches } = start();
    h.sockets[0]?.handlers.onOpen();

    h.sockets[0]?.handlers.onClose();
    expect(h.sockets).toHaveLength(1);
    h.advance(500);
    h.sockets[1]?.handlers.onOpen();

    expect(h.sockets.map((s) => s.url)).toEqual(["ws://x/live", "ws://x/live"]);
    expect(refetches()).toBe(2);
  });

  it("backs off while connections keep failing", () => {
    const { h } = start(1);

    expect([reconnectDelay(h), reconnectDelay(h), reconnectDelay(h)]).toEqual([500, 1000, 2000]);
  });

  it("keeps backing off when the server accepts and then drops the socket at once", () => {
    const { h } = start(1);
    const delays: number[] = [];

    for (let round = 0; round < 3; round += 1) {
      h.sockets.at(-1)?.handlers.onOpen();
      delays.push(reconnectDelay(h));
    }

    expect(delays).toEqual([500, 1000, 2000]);
  });

  it("starts the backoff over once a socket has stayed open long enough", () => {
    const { h } = start(1);
    reconnectDelay(h);
    reconnectDelay(h);

    h.sockets.at(-1)?.handlers.onOpen();
    h.advance(9999);
    h.sockets.at(-1)?.handlers.onClose();
    // Closed a millisecond short of stable: the next delay is still the third one.
    h.advance(1999);
    expect(h.sockets).toHaveLength(3);
    h.advance(1);
    expect(h.sockets).toHaveLength(4);

    h.sockets.at(-1)?.handlers.onOpen();
    h.advance(10_000);

    expect(reconnectDelay(h)).toBe(500);
  });

  it("starts the backoff over after a live message", () => {
    const { h } = start(1);
    reconnectDelay(h);
    reconnectDelay(h);

    h.sockets.at(-1)?.handlers.onOpen();
    h.sockets.at(-1)?.handlers.onMessage(JSON.stringify({ version: 1 }));

    expect(reconnectDelay(h)).toBe(500);
  });

  it("ignores events from a socket it has already replaced", () => {
    const { h, refetches } = start();
    const old = h.sockets[0];
    old?.handlers.onClose();
    h.advance(500);

    old?.handlers.onClose();
    old?.handlers.onOpen();
    old?.handlers.onMessage(JSON.stringify({ version: 1 }));
    h.advance(60_000);

    expect(h.sockets).toHaveLength(2);
    expect(refetches()).toBe(0);
  });

  describe("heartbeat", () => {
    it("sends a ping every 25 seconds once a pong comes back", () => {
      const { h } = start();
      const socket = h.sockets[0];
      socket?.handlers.onOpen();

      h.advance(24_999);
      expect(socket?.sent).toEqual([]);
      h.advance(1);
      expect(socket?.sent).toEqual(["ping"]);

      socket?.handlers.onMessage("pong");
      h.advance(25_000);

      expect(socket?.sent).toEqual(["ping", "ping"]);
      expect(h.sockets).toHaveLength(1);
    });

    it("treats a missing pong as a dead socket: closes it and reconnects", () => {
      const { h, refetches } = start();
      const socket = h.sockets[0];
      socket?.handlers.onOpen();
      h.advance(25_000);

      h.advance(9999);
      expect(socket?.closed).toBe(false);
      h.advance(1);

      expect(socket?.closed).toBe(true);
      h.advance(500);
      expect(h.sockets).toHaveLength(2);
      h.sockets[1]?.handlers.onOpen();
      expect(refetches()).toBe(2);
      // The dead socket's own close event arrives late and must not start a second reconnect.
      socket?.handlers.onClose();
      h.advance(5000);
      expect(h.sockets).toHaveLength(2);
    });

    it("doesn't ping a socket that has closed", () => {
      const { h } = start();
      const socket = h.sockets[0];
      socket?.handlers.onOpen();
      socket?.handlers.onClose();

      h.advance(25_000);

      expect(socket?.sent).toEqual([]);
    });
  });

  describe("stopping", () => {
    it("closes the socket and leaves no timer behind", () => {
      const { h, stop } = start();
      h.sockets[0]?.handlers.onOpen();

      stop();
      h.sockets[0]?.handlers.onClose();

      expect(h.sockets[0]?.closed).toBe(true);
      expect(h.timers.size).toBe(0);
      expect(h.sockets).toHaveLength(1);
    });

    it("cancels a pending reconnect", () => {
      const { h, stop } = start();
      h.sockets[0]?.handlers.onClose();
      expect(h.timers.size).toBe(1);

      stop();
      h.advance(60_000);

      expect(h.timers.size).toBe(0);
      expect(h.sockets).toHaveLength(1);
    });
  });
});

describe("backoffDelayMs", () => {
  it("doubles from 500ms with each failed attempt", () => {
    expect([0, 1, 2, 3].map((n) => backoffDelayMs(n, 1))).toEqual([500, 1000, 2000, 4000]);
  });

  it("caps at 30 seconds", () => {
    expect(backoffDelayMs(6, 1)).toBe(30_000);
    expect(backoffDelayMs(50, 1)).toBe(30_000);
  });

  it("spreads delays between half and all of the ceiling", () => {
    expect(backoffDelayMs(2, 0)).toBe(1000);
    expect(backoffDelayMs(2, 0.5)).toBe(1500);
    expect(backoffDelayMs(2, 1)).toBe(2000);
  });
});

describe("liveUrl", () => {
  it("uses wss on https and ws on http, on the page's own host", () => {
    expect(liveUrl({ protocol: "https:", host: "app.andthen.page" }, "abc12")).toBe(
      "wss://app.andthen.page/api/stories/abc12/live",
    );
    expect(liveUrl({ protocol: "http:", host: "localhost:5173" }, "abc12")).toBe(
      "ws://localhost:5173/api/stories/abc12/live",
    );
  });
});

function watch(endsAt: number | null, startAt: number) {
  const h = harness(0, startAt);
  let refetches = 0;
  const cancel = refetchWhenTurnEnds(
    endsAt,
    () => {
      refetches += 1;
    },
    h.deps,
  );

  return { h, cancel, refetches: () => refetches };
}

describe("refetchWhenTurnEnds", () => {
  it("fires a second after the turn ends by the client clock", () => {
    const { h, refetches } = watch(10_000, 4000);

    h.advance(6999);
    expect(refetches()).toBe(0);
    h.advance(1);

    expect(refetches()).toBe(1);
  });

  it("fires soon for a turn that already ended", () => {
    const { h, refetches } = watch(1000, 5000);

    h.advance(1000);

    expect(refetches()).toBe(1);
  });

  it("tries again every 5 seconds while the same turn is still showing", () => {
    // The client clock runs ahead, so the first refetch finds the turn unchanged: the timer
    // fires and the page's endsAt stays the same, so nothing else would ever re-arm it.
    const { h, refetches } = watch(10_000, 10_000);

    h.advance(1000);
    expect(refetches()).toBe(1);
    h.advance(4999);
    expect(refetches()).toBe(1);
    h.advance(1);
    expect(refetches()).toBe(2);
    h.advance(5000);
    expect(refetches()).toBe(3);
  });

  it("stops trying once cancelled, which is what a changed endsAt does", () => {
    const { h, cancel, refetches } = watch(10_000, 10_000);
    h.advance(1000);

    cancel();
    h.advance(60_000);

    expect(refetches()).toBe(1);
    expect(h.timers.size).toBe(0);
  });

  it("schedules nothing while the story waits for a joiner", () => {
    const { h, cancel } = watch(null, 5000);
    cancel();

    expect(h.timers.size).toBe(0);
  });

  it("can be cancelled before it fires", () => {
    const { h, cancel, refetches } = watch(10_000, 0);

    cancel();
    h.advance(60_000);

    expect(refetches()).toBe(0);
  });
});
