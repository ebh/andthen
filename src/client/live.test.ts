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
  closed: boolean;
}

interface Harness {
  deps: LiveDeps;
  sockets: FakeSocket[];
  /** Pending timers by id, with their delay. */
  timers: Map<number, { callback: () => void; delayMs: number }>;
  fireTimers: () => void;
}

function harness(random = 0): Harness {
  const sockets: FakeSocket[] = [];
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  let nextTimerId = 1;

  return {
    sockets,
    timers,
    fireTimers: () => {
      for (const [id, timer] of Array.from(timers)) {
        timers.delete(id);
        timer.callback();
      }
    },
    deps: {
      openSocket: (url, handlers) => {
        const socket: FakeSocket = { url, handlers, closed: false };
        sockets.push(socket);

        return {
          close: () => {
            socket.closed = true;
          },
        };
      },
      setTimer: (callback, delayMs) => {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, { callback, delayMs });

        return id;
      },
      clearTimer: (timer) => {
        if (typeof timer === "number") {
          timers.delete(timer);
        }
      },
      random: () => random,
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
    h.fireTimers();
    h.sockets[1]?.handlers.onOpen();

    expect(h.sockets.map((s) => s.url)).toEqual(["ws://x/live", "ws://x/live"]);
    expect(refetches()).toBe(2);
  });

  it("backs off while connections keep failing and starts over after one opens", () => {
    const { h } = start(1);
    const delays: number[] = [];
    const failAndRetry = (): void => {
      h.sockets.at(-1)?.handlers.onClose();
      delays.push(...[...h.timers.values()].map((t) => t.delayMs));
      h.fireTimers();
    };

    failAndRetry();
    failAndRetry();
    failAndRetry();
    h.sockets.at(-1)?.handlers.onOpen();
    failAndRetry();

    expect(delays).toEqual([500, 1000, 2000, 500]);
  });

  it("stops: closes the socket and reconnects no more", () => {
    const { h, stop } = start();

    stop();
    h.sockets[0]?.handlers.onClose();

    expect(h.sockets[0]?.closed).toBe(true);
    expect(h.timers.size).toBe(0);
    expect(h.sockets).toHaveLength(1);
  });

  it("cancels a pending reconnect when stopped", () => {
    const { h, stop } = start();
    h.sockets[0]?.handlers.onClose();
    expect(h.timers.size).toBe(1);

    stop();
    h.fireTimers();

    expect(h.timers.size).toBe(0);
    expect(h.sockets).toHaveLength(1);
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

describe("refetchWhenTurnEnds", () => {
  it("fires the refetch a second after the turn ends, by the given clock", () => {
    const h = harness();
    let refetches = 0;

    refetchWhenTurnEnds(
      10_000,
      4000,
      () => {
        refetches += 1;
      },
      h.deps,
    );

    expect([...h.timers.values()].map((t) => t.delayMs)).toEqual([7000]);
    h.fireTimers();
    expect(refetches).toBe(1);
  });

  it("fires soon for a turn that already ended", () => {
    const h = harness();

    refetchWhenTurnEnds(1000, 5000, () => undefined, h.deps);

    expect([...h.timers.values()].map((t) => t.delayMs)).toEqual([1000]);
  });

  it("schedules nothing while the story waits for a joiner", () => {
    const h = harness();

    const cancel = refetchWhenTurnEnds(null, 5000, () => undefined, h.deps);
    cancel();

    expect(h.timers.size).toBe(0);
  });

  it("can be cancelled", () => {
    const h = harness();
    let refetches = 0;
    const cancel = refetchWhenTurnEnds(
      10_000,
      0,
      () => {
        refetches += 1;
      },
      h.deps,
    );

    cancel();
    h.fireTimers();

    expect(refetches).toBe(0);
  });
});
