import { describe, expect, it, vi } from "vitest";

import { openSocketWithSession, type SocketFactory, type SocketHandlers } from "./live";

const handlers: SocketHandlers = {
  onOpen: vi.fn<() => void>(),
  onMessage: vi.fn<(data: unknown) => void>(),
  onClose: vi.fn<() => void>(),
};

function setup(token: string | null) {
  const inner = { send: vi.fn<(text: string) => void>(), close: vi.fn<() => void>() };
  const createSocket = vi.fn<SocketFactory>(() => inner);
  const tokenReady = Promise.withResolvers<string | null>();
  const socket = openSocketWithSession(
    "ws://x/live",
    handlers,
    () => tokenReady.promise,
    createSocket,
  );

  return {
    socket,
    inner,
    createSocket,
    giveToken: () => {
      tokenReady.resolve(token);
    },
  };
}

describe("openSocketWithSession", () => {
  it("opens nothing until the token is known", () => {
    const { createSocket } = setup("tok");

    expect(createSocket).not.toHaveBeenCalled();
  });

  it("offers the live subprotocol and then the token", async () => {
    const { createSocket, giveToken } = setup("tok");

    giveToken();
    await Promise.resolve();

    expect(createSocket).toHaveBeenCalledWith("ws://x/live", ["andthen-live", "tok"], handlers);
  });

  it("offers only the live subprotocol when anonymous", async () => {
    const { createSocket, giveToken } = setup(null);

    giveToken();
    await Promise.resolve();

    expect(createSocket).toHaveBeenCalledWith("ws://x/live", ["andthen-live"], handlers);
  });

  it("passes send and close on to the opened socket", async () => {
    const { socket, inner, giveToken } = setup("tok");
    giveToken();
    await Promise.resolve();

    socket.send("ping");
    socket.close();

    expect(inner.send).toHaveBeenCalledWith("ping");
    expect(inner.close).toHaveBeenCalledOnce();
  });

  it("ignores a send before the socket exists", () => {
    const { socket, inner } = setup("tok");

    socket.send("ping");

    expect(inner.send).not.toHaveBeenCalled();
  });

  it("opens nothing when closed before the token arrives", async () => {
    const { socket, createSocket, giveToken } = setup("tok");

    socket.close();
    giveToken();
    await Promise.resolve();

    expect(createSocket).not.toHaveBeenCalled();
  });
});
