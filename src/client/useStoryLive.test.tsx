// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStoryLive } from "./useStoryLive";

const sockets: FakeSocket[] = [];

class FakeSocket extends EventTarget {
  closed = false;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
    sockets.push(this);
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.dispatchEvent(new Event("open"));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal("WebSocket", FakeSocket);
  sockets.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function live(endsAt: number | null = null) {
  const refetch = vi.fn<() => void>();
  const hook = renderHook(
    (props) => {
      useStoryLive(props);
    },
    { initialProps: { storyId: "abc12", endsAt, refetch } },
  );

  return { refetch, ...hook };
}

describe("useStoryLive socket", () => {
  it("connects to the story's live address on the page's own host", () => {
    live();

    expect(sockets.map((socket) => socket.url)).toEqual([
      `ws://${window.location.host}/api/stories/abc12/live`,
    ]);
  });

  it("refetches when the socket opens, so a change missed while offline is caught", () => {
    const { refetch } = live();

    sockets[0]?.open();

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("refetches on a live message and ignores anything else", () => {
    const { refetch } = live();
    sockets[0]?.open();
    refetch.mockClear();

    sockets[0]?.receive("not json");
    expect(refetch).not.toHaveBeenCalled();

    sockets[0]?.receive(JSON.stringify({ version: 4 }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("closes the socket on unmount and does not reconnect", () => {
    const { unmount } = live();

    unmount();
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.closed).toBe(true);
  });

  it("keeps the same socket when only the refetch callback changes, and calls the latest one", () => {
    const { rerender, refetch } = live();
    const newer = vi.fn<() => void>();

    rerender({ storyId: "abc12", endsAt: null, refetch: newer });
    sockets[0]?.open();

    expect(sockets).toHaveLength(1);
    expect(newer).toHaveBeenCalledOnce();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("opens a new socket for another story and closes the old one", () => {
    const { rerender, refetch } = live();

    rerender({ storyId: "zzzzz", endsAt: null, refetch });

    expect(sockets.map((socket) => socket.url.split("/").at(-2))).toEqual(["abc12", "zzzzz"]);
    expect(sockets[0]?.closed).toBe(true);
  });

  it("reconnects after the socket drops", () => {
    live();

    sockets[0]?.dispatchEvent(new Event("close"));
    vi.advanceTimersByTime(30_000);

    expect(sockets).toHaveLength(2);
  });
});

describe("useStoryLive turn end", () => {
  it("refetches shortly after the turn ends, since no message announces a timeout", () => {
    const { refetch } = live(1_000_000 + 60_000);

    vi.advanceTimersByTime(60_000);
    expect(refetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("schedules nothing for a story that waits for a joiner", () => {
    const { refetch } = live(null);

    vi.advanceTimersByTime(24 * 3_600_000);

    expect(refetch).not.toHaveBeenCalled();
  });

  it("drops the pending timer when the turn moves on, and times the new turn", () => {
    const { rerender, refetch } = live(1_000_000 + 60_000);

    rerender({ storyId: "abc12", endsAt: 1_000_000 + 120_000, refetch });
    vi.advanceTimersByTime(61_000);
    expect(refetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("drops the pending timer on unmount", () => {
    const { unmount, refetch } = live(1_000_000 + 60_000);

    unmount();
    vi.advanceTimersByTime(120_000);

    expect(refetch).not.toHaveBeenCalled();
  });
});
