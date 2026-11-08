// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

vi.mock("./api", () => ({
  fetchVapidPublicKey: vi.fn<typeof api.fetchVapidPublicKey>(),
  savePushSubscription: vi.fn<typeof api.savePushSubscription>(),
  removePushSubscription: vi.fn<typeof api.removePushSubscription>(),
}));

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15";
const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  toJSON: () => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) },
  }),
  unsubscribe: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
};

// Each test needs a fresh module: the browser's alerts object is created on first use and kept.
async function loadTurnAlerts() {
  vi.resetModules();

  return import("./turnAlerts");
}

interface Browser {
  permission?: NotificationPermission;
  userAgent?: string;
  standaloneDisplay?: boolean;
  standaloneFlag?: boolean;
  withPushApi?: boolean;
}

function stubBrowser({
  permission = "default",
  userAgent,
  standaloneDisplay = false,
  standaloneFlag,
  withPushApi = true,
}: Browser = {}) {
  vi.stubEnv("NODE_ENV", "production");
  const pushManager = {
    getSubscription: vi.fn<() => Promise<typeof SUBSCRIPTION | null>>().mockResolvedValue(null),
    subscribe: vi.fn<() => Promise<typeof SUBSCRIPTION>>().mockResolvedValue(SUBSCRIPTION),
  };
  const requestPermission = vi
    .fn<() => Promise<NotificationPermission>>()
    .mockResolvedValue("granted");
  vi.stubGlobal(
    "Notification",
    Object.assign(vi.fn<() => void>(), { permission, requestPermission }),
  );
  vi.stubGlobal("PushManager", withPushApi ? vi.fn<() => void>() : undefined);
  if (!withPushApi) {
    Reflect.deleteProperty(window, "PushManager");
  }
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(display-mode: standalone)" && standaloneDisplay,
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  if (userAgent !== undefined) {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  }
  if (standaloneFlag !== undefined) {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: standaloneFlag });
  }

  return { pushManager, requestPermission };
}

beforeEach(() => {
  vi.mocked(api.fetchVapidPublicKey).mockResolvedValue({
    ok: true,
    value: { publicKey: "server-key" },
  });
  vi.mocked(api.savePushSubscription).mockResolvedValue({ ok: true, value: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(navigator, "standalone");
});

describe("useTurnAlerts", () => {
  it("is unavailable outside a production build", async () => {
    stubBrowser();
    vi.unstubAllEnvs();
    const { useTurnAlerts } = await loadTurnAlerts();

    const { result } = renderHook(() => useTurnAlerts());

    expect(result.current.state).toEqual({ type: "unavailable" });
  });

  it("is unavailable in a browser without the Push API", async () => {
    stubBrowser({ withPushApi: false });
    const { useTurnAlerts } = await loadTurnAlerts();

    const { result } = renderHook(() => useTurnAlerts());

    expect(result.current.state).toEqual({ type: "unavailable" });
  });

  it("is blocked when the browser's permission is denied", async () => {
    stubBrowser({ permission: "denied" });
    const { useTurnAlerts } = await loadTurnAlerts();

    const { result } = renderHook(() => useTurnAlerts());

    expect(result.current.state).toEqual({ type: "blocked" });
  });

  it("asks an iPhone tab to install the app first", async () => {
    stubBrowser({ userAgent: IPHONE_UA, withPushApi: false });
    const { useTurnAlerts } = await loadTurnAlerts();

    const { result } = renderHook(() => useTurnAlerts());

    expect(result.current.state).toEqual({ type: "needs_install" });
  });

  it.each([
    ["the display mode", { standaloneDisplay: true }],
    ["Safari's standalone flag", { standaloneFlag: true }],
  ])("treats an iPhone as installed by %s", async (_name, installed) => {
    stubBrowser({ userAgent: IPHONE_UA, ...installed });
    const { useTurnAlerts } = await loadTurnAlerts();

    const { result } = renderHook(() => useTurnAlerts());

    expect(result.current.state).toMatchObject({ type: "ready" });
  });

  it("does not treat an iPhone as installed when Safari's flag is false", async () => {
    stubBrowser({ userAgent: IPHONE_UA, standaloneFlag: false });
    const { useTurnAlerts } = await loadTurnAlerts();

    const { result } = renderHook(() => useTurnAlerts());

    expect(result.current.state).toEqual({ type: "needs_install" });
  });

  it("turns on through the browser's prompt and push manager, and shows it", async () => {
    const { pushManager, requestPermission } = stubBrowser();
    const { useTurnAlerts } = await loadTurnAlerts();
    const { result } = renderHook(() => useTurnAlerts());

    await act(async () => {
      await result.current.turnOn();
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledExactlyOnceWith({
      userVisibleOnly: true,
      applicationServerKey: "server-key",
    });
    expect(result.current.state).toEqual({ type: "ready", on: true, busy: false, failed: false });
  });

  it("turns off by unsubscribing what the browser holds", async () => {
    const { pushManager } = stubBrowser({ permission: "granted" });
    pushManager.getSubscription.mockResolvedValue(SUBSCRIPTION);
    vi.mocked(api.removePushSubscription).mockResolvedValue({ ok: true, value: null });
    const { startTurnAlerts, useTurnAlerts } = await loadTurnAlerts();
    const { result } = renderHook(() => useTurnAlerts());
    await act(async () => {
      await startTurnAlerts();
    });
    expect(result.current.state).toMatchObject({ on: true });

    await act(async () => {
      await result.current.turnOff();
    });

    expect(SUBSCRIPTION.unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.removePushSubscription).toHaveBeenCalledExactlyOnceWith(SUBSCRIPTION.endpoint);
    expect(result.current.state).toMatchObject({ on: false });
  });
});

describe("startTurnAlerts", () => {
  it("sends the subscription the browser holds to the Worker", async () => {
    const { pushManager } = stubBrowser({ permission: "granted" });
    pushManager.getSubscription.mockResolvedValue(SUBSCRIPTION);
    const { startTurnAlerts } = await loadTurnAlerts();

    await startTurnAlerts();

    expect(api.savePushSubscription).toHaveBeenCalledTimes(1);
  });
});
