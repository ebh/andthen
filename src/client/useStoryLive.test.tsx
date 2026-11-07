// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setSessionSource } from "./sessionToken";
import { useStoryLive } from "./useStoryLive";

const sockets: FakeSocket[] = [];

class FakeSocket extends EventTarget {
  closed = false;
  sent: string[] = [];

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
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

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function live(endsAt: number | null = null) {
  const refetch = vi.fn<() => void>();
  const hook = renderHook(
    (props) => {
      useStoryLive(props);
    },
    { initialProps: { storyId: "abc12", endsAt, refetch } },
  );

  await settle();

  return { refetch, ...hook };
}

describe("useStoryLive socket", () => {
  it("connects to the story's live address on the page's own host", async () => {
    await live();

    expect(sockets.map((socket) => socket.url)).toEqual([
      `ws://${window.location.host}/api/stories/abc12/live`,
    ]);
  });

  it("offers only the live subprotocol when nobody is signed in", async () => {
    await live();

    expect(sockets[0]?.protocols).toEqual(["andthen-live"]);
  });

  it("offers the session token after the live subprotocol when signed in", async () => {
    setSessionSource({ isLoaded: true, getToken: () => Promise.resolve("tok-1") });

    await live();

    expect(sockets[0]?.protocols).toEqual(["andthen-live", "tok-1"]);
  });

  it("refetches when the socket opens, so a change missed while offline is caught", async () => {
    const { refetch } = await live();

    sockets[0]?.open();

    expect(refetch).toHaveBeenCalledOnce();
  });

  it("refetches on a live message and ignores anything else", async () => {
    const { refetch } = await live();
    sockets[0]?.open();
    refetch.mockClear();

    sockets[0]?.receive("not json");
    expect(refetch).not.toHaveBeenCalled();

    sockets[0]?.receive(JSON.stringify({ version: 4 }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("closes the socket on unmount and does not reconnect", async () => {
    const { unmount } = await live();

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.closed).toBe(true);
  });

  it("keeps the same socket when only the refetch callback changes, and calls the latest one", async () => {
    const { rerender, refetch } = await live();
    const newer = vi.fn<() => void>();

    rerender({ storyId: "abc12", endsAt: null, refetch: newer });
    await settle();
    sockets[0]?.open();

    expect(sockets).toHaveLength(1);
    expect(newer).toHaveBeenCalledOnce();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("opens a new socket for another story and closes the old one", async () => {
    const { rerender, refetch } = await live();

    rerender({ storyId: "zzzzz", endsAt: null, refetch });
    await settle();

    expect(sockets.map((socket) => socket.url.split("/").at(-2))).toEqual(["abc12", "zzzzz"]);
    expect(sockets[0]?.closed).toBe(true);
  });

  it("reconnects after the socket drops", async () => {
    await live();

    sockets[0]?.dispatchEvent(new Event("close"));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sockets).toHaveLength(2);
  });
});

describe("useStoryLive turn end", () => {
  it("refetches shortly after the turn ends, since no message announces a timeout", async () => {
    const { refetch } = await live(1_000_000 + 60_000);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("schedules nothing for a story that waits for a joiner", async () => {
    const { refetch } = await live(null);

    await vi.advanceTimersByTimeAsync(24 * 3_600_000);

    expect(refetch).not.toHaveBeenCalled();
  });

  it("drops the pending timer when the turn moves on, and times the new turn", async () => {
    const { rerender, refetch } = await live(1_000_000 + 60_000);

    rerender({ storyId: "abc12", endsAt: 1_000_000 + 120_000, refetch });
    await settle();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(refetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("drops the pending timer on unmount", async () => {
    const { unmount, refetch } = await live(1_000_000 + 60_000);

    unmount();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(refetch).not.toHaveBeenCalled();
  });
});
