import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STALE_TURN_RETRY_DELAY_MS, onDeviceUserAdded, addDeviceUserToAccount } from "./account";
import { jsonResponse, noContentResponse } from "./testFixtures";

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

const staleTurn = () => jsonResponse(409, { error: "stale_turn" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("addDeviceUserToAccount", () => {
  it("sends PUT /api/users/me/account", async () => {
    const fetchMock = stubFetch(noContentResponse());

    await addDeviceUserToAccount();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/users/me/account");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
  });

  it("tells listeners once it worked", async () => {
    stubFetch(noContentResponse());
    const listener = vi.fn<() => void>();
    const stop = onDeviceUserAdded(listener);

    await addDeviceUserToAccount();
    stop();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("stops telling a listener that unsubscribed", async () => {
    stubFetch(noContentResponse());
    const listener = vi.fn<() => void>();
    onDeviceUserAdded(listener)();

    await addDeviceUserToAccount();

    expect(listener).not.toHaveBeenCalled();
  });

  it("retries once after a stale_turn clash, waiting first", async () => {
    const fetchMock = stubFetch(staleTurn(), noContentResponse());
    const listener = vi.fn<() => void>();
    const stop = onDeviceUserAdded(listener);

    const pending = addDeviceUserToAccount();
    await vi.advanceTimersByTimeAsync(STALE_TURN_RETRY_DELAY_MS - 1);
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    stop();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("gives up quietly when the retry clashes again", async () => {
    const fetchMock = stubFetch(staleTurn(), staleTurn(), noContentResponse());
    const listener = vi.fn<() => void>();
    const stop = onDeviceUserAdded(listener);

    const pending = addDeviceUserToAccount();
    await vi.advanceTimersByTimeAsync(STALE_TURN_RETRY_DELAY_MS);
    await pending;
    stop();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores any other failure without retrying", async () => {
    const fetchMock = stubFetch(jsonResponse(401, { error: "invalid_session_token" }));
    const listener = vi.fn<() => void>();
    const stop = onDeviceUserAdded(listener);

    await expect(addDeviceUserToAccount()).resolves.toBeUndefined();
    stop();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });

  it("shares one request between overlapping callers", async () => {
    const fetchMock = stubFetch(noContentResponse());

    await Promise.all([addDeviceUserToAccount(), addDeviceUserToAccount()]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends a new request for a call made after the last one finished", async () => {
    const fetchMock = stubFetch(noContentResponse(), noContentResponse());

    await addDeviceUserToAccount();
    await addDeviceUserToAccount();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
