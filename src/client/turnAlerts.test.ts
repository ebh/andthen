import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResult } from "./api";
import * as api from "./api";
import {
  availabilityOf,
  createTurnAlerts,
  type BrowserFacts,
  type NotificationPermissionState,
  type PushManagerHandle,
  type PushSubscriptionHandle,
  type TurnAlertsAvailability,
  type TurnAlertsEnvironment,
} from "./turnAlerts";

vi.mock("./api", () => ({
  fetchPushKey: vi.fn<typeof api.fetchPushKey>(),
  savePushSubscription: vi.fn<typeof api.savePushSubscription>(),
  removePushSubscription: vi.fn<typeof api.removePushSubscription>(),
}));

const WORKER_TIMEOUT_MS = 10_000;
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const KEYS = { p256dh: "p".repeat(87), auth: "a".repeat(22) };
const OK: ApiResult<null> = { ok: true, value: null };
const FAILED: ApiResult<null> = { ok: false, failure: { type: "network" } };

interface Options {
  availability?: TurnAlertsAvailability;
  permission?: NotificationPermissionState;
  /** What the prompt answers when the user is asked. */
  answer?: NotificationPermissionState;
  held?: boolean;
  subscribeFails?: boolean;
  unsubscribeResult?: boolean | "throws";
  /** The browser's `toJSON()` for its subscription. */
  json?: unknown;
  workerNeverReady?: boolean;
}

function setUp(options: Options = {}) {
  let permission = options.permission ?? "default";
  const subscription = {
    endpoint: ENDPOINT,
    toJSON: vi.fn<() => unknown>(() => options.json ?? { endpoint: ENDPOINT, keys: KEYS }),
    unsubscribe: vi.fn<() => Promise<boolean>>(() =>
      options.unsubscribeResult === "throws"
        ? Promise.reject(new Error("refused"))
        : Promise.resolve(options.unsubscribeResult ?? true),
    ),
  } satisfies PushSubscriptionHandle;
  const manager = {
    getSubscription: vi.fn<PushManagerHandle["getSubscription"]>(() =>
      Promise.resolve(options.held === true ? subscription : null),
    ),
    subscribe: vi.fn<PushManagerHandle["subscribe"]>(() =>
      options.subscribeFails === true
        ? Promise.reject(new Error("push service error"))
        : Promise.resolve(subscription),
    ),
  } satisfies PushManagerHandle;
  const environment = {
    availability: options.availability ?? "available",
    permission: vi.fn<() => NotificationPermissionState>(() => permission),
    requestPermission: vi.fn<() => Promise<NotificationPermissionState>>(() => {
      permission = options.answer ?? "granted";

      return Promise.resolve(permission);
    }),
    pushManager: vi.fn<() => Promise<PushManagerHandle>>(() =>
      options.workerNeverReady === true ? new Promise(() => undefined) : Promise.resolve(manager),
    ),
  } satisfies TurnAlertsEnvironment;
  const alerts = createTurnAlerts(environment);

  return { alerts, environment, manager, subscription };
}

beforeEach(() => {
  vi.mocked(api.fetchPushKey).mockResolvedValue({ ok: true, value: { publicKey: "server-key" } });
  vi.mocked(api.savePushSubscription).mockResolvedValue(OK);
  vi.mocked(api.removePushSubscription).mockResolvedValue(OK);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the state before anything is asked", () => {
  it.each([["unavailable"], ["needs_install"]] as const)(
    "is %s when the browser says so",
    (type) => {
      const { alerts } = setUp({ availability: type });

      expect(alerts.getSnapshot()).toEqual({ type });
    },
  );

  it("is blocked when the user has refused notifications", () => {
    const { alerts } = setUp({ permission: "denied" });

    expect(alerts.getSnapshot()).toEqual({ type: "blocked" });
  });

  it.each([["default"], ["granted"]] as const)(
    "is off and idle when permission is %s",
    (permission) => {
      const { alerts } = setUp({ permission });

      expect(alerts.getSnapshot()).toEqual({
        type: "ready",
        on: false,
        busy: false,
        failed: false,
      });
    },
  );

  it("is not blocked in a browser that cannot offer alerts, whatever it says about permission", () => {
    const { alerts } = setUp({ availability: "unavailable", permission: "denied" });

    expect(alerts.getSnapshot()).toEqual({ type: "unavailable" });
  });
});

describe("turning on", () => {
  it("asks permission, subscribes with the server's key and sends the subscription", async () => {
    const { alerts, environment, manager } = setUp();

    await alerts.turnOn();

    expect(environment.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.fetchPushKey).toHaveBeenCalledTimes(1);
    expect(manager.subscribe).toHaveBeenCalledExactlyOnceWith({
      userVisibleOnly: true,
      applicationServerKey: "server-key",
    });
    expect(api.savePushSubscription).toHaveBeenCalledExactlyOnceWith({
      endpoint: ENDPOINT,
      keys: KEYS,
    });
    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: true, busy: false, failed: false });
  });

  it("asks for permission before anything else, so it still counts as the user's tap", async () => {
    const { alerts, environment } = setUp();
    const order: string[] = [];
    environment.requestPermission.mockImplementation(() => {
      order.push("permission");

      return Promise.resolve("granted");
    });
    vi.mocked(api.fetchPushKey).mockImplementation(() => {
      order.push("key");

      return Promise.resolve({ ok: true, value: { publicKey: "k" } });
    });

    const turned = alerts.turnOn();

    expect(order).toEqual(["permission"]);
    await turned;
    expect(order).toEqual(["permission", "key"]);
  });

  it("is busy while the request runs, and refuses a second toggle", async () => {
    const { alerts, environment } = setUp();
    const answer = Promise.withResolvers<NotificationPermissionState>();
    environment.requestPermission.mockReturnValue(answer.promise);

    const first = alerts.turnOn();
    const second = alerts.turnOn();

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: true, failed: false });
    await second;
    expect(environment.requestPermission).toHaveBeenCalledTimes(1);

    answer.resolve("granted");
    await first;
    await alerts.turnOn();
    expect(environment.requestPermission).toHaveBeenCalledTimes(2);
  });

  it("tells listeners about each change and stops after they unsubscribe", async () => {
    const { alerts } = setUp();
    const listener = vi.fn<() => void>();
    const unsubscribe = alerts.subscribe(listener);

    await alerts.turnOn();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    await alerts.turnOff();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("becomes blocked when the user refuses the prompt, and subscribes to nothing", async () => {
    const { alerts, manager } = setUp({ answer: "denied" });

    await alerts.turnOn();

    expect(alerts.getSnapshot()).toEqual({ type: "blocked" });
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(api.fetchPushKey).not.toHaveBeenCalled();
  });

  it("stays off, with no error, when the prompt is dismissed", async () => {
    const { alerts, manager } = setUp({ answer: "default" });

    await alerts.turnOn();

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: false });
    expect(manager.subscribe).not.toHaveBeenCalled();
  });

  it("fails when asking permission throws", async () => {
    const { alerts, environment } = setUp();
    environment.requestPermission.mockRejectedValue(new Error("no prompt here"));

    await alerts.turnOn();

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: true });
  });

  it("fails, and says so, when the browser cannot subscribe", async () => {
    const { alerts } = setUp({ subscribeFails: true });

    await alerts.turnOn();

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: true });
    expect(api.savePushSubscription).not.toHaveBeenCalled();
  });

  it("fails when the service worker never becomes ready", async () => {
    vi.useFakeTimers();
    const { alerts } = setUp({ workerNeverReady: true });

    const turned = alerts.turnOn();
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS - 1);
    expect(alerts.getSnapshot()).toMatchObject({ busy: true });
    await vi.advanceTimersByTimeAsync(1);
    await turned;

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: true });
  });

  it("fails when the server's key cannot be fetched, and tries again on the next tap", async () => {
    vi.mocked(api.fetchPushKey).mockResolvedValueOnce(FAILED);
    const { alerts, manager } = setUp();

    await alerts.turnOn();
    expect(alerts.getSnapshot()).toMatchObject({ on: false, failed: true });
    expect(manager.subscribe).not.toHaveBeenCalled();

    await alerts.turnOn();
    expect(alerts.getSnapshot()).toMatchObject({ on: true, failed: false });
  });

  it("undoes the browser's subscription when the Worker will not take it", async () => {
    vi.mocked(api.savePushSubscription).mockResolvedValue(FAILED);
    const { alerts, subscription } = setUp();

    await alerts.turnOn();

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: true });
  });

  it("undoes the browser's subscription when it is not one the Worker accepts", async () => {
    const { alerts, subscription } = setUp({
      json: { endpoint: "https://evil.example/x", keys: KEYS },
    });

    await alerts.turnOn();

    expect(api.savePushSubscription).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(alerts.getSnapshot()).toMatchObject({ on: false, failed: true });
  });

  it("still fails cleanly when undoing the subscription throws", async () => {
    vi.mocked(api.savePushSubscription).mockResolvedValue(FAILED);
    const { alerts } = setUp({ unsubscribeResult: "throws" });

    await alerts.turnOn();

    expect(alerts.getSnapshot()).toMatchObject({ on: false, failed: true });
  });

  it("clears an earlier failure when the next attempt starts", async () => {
    const { alerts, manager } = setUp({ subscribeFails: true });
    await alerts.turnOn();
    manager.subscribe.mockRejectedValue(new Error("again"));
    const listener = vi.fn<() => void>();
    alerts.subscribe(listener);

    const turned = alerts.turnOn();

    expect(alerts.getSnapshot()).toMatchObject({ busy: true, failed: false });
    await turned;
  });

  it("uses the key fetched at start instead of fetching again", async () => {
    const { alerts } = setUp();

    await alerts.start();
    expect(api.fetchPushKey).toHaveBeenCalledTimes(1);
    await alerts.turnOn();

    expect(api.fetchPushKey).toHaveBeenCalledTimes(1);
  });

  it("does nothing when alerts are not offered here", async () => {
    const { alerts, environment } = setUp({ availability: "needs_install" });

    await alerts.turnOn();

    expect(environment.requestPermission).not.toHaveBeenCalled();
    expect(alerts.getSnapshot()).toEqual({ type: "needs_install" });
  });
});

describe("turning off", () => {
  it("unsubscribes the browser and deletes the Worker's copy", async () => {
    const { alerts, subscription } = setUp({ permission: "granted", held: true });
    await alerts.start();
    expect(alerts.getSnapshot()).toMatchObject({ on: true });

    await alerts.turnOff();

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.removePushSubscription).toHaveBeenCalledExactlyOnceWith(ENDPOINT);
    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: false });
  });

  it("is busy while it runs", async () => {
    const { alerts, subscription } = setUp({ permission: "granted", held: true });
    await alerts.start();
    const done = Promise.withResolvers<boolean>();
    subscription.unsubscribe.mockReturnValue(done.promise);

    const turned = alerts.turnOff();
    expect(alerts.getSnapshot()).toMatchObject({ on: true, busy: true });
    await vi.waitFor(() => {
      expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    });
    await alerts.turnOff();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);

    done.resolve(true);
    await turned;
  });

  it("is off even when the Worker cannot be reached, because the browser no longer sends to it", async () => {
    vi.mocked(api.removePushSubscription).mockResolvedValue(FAILED);
    const { alerts } = setUp({ permission: "granted", held: true });
    await alerts.start();

    await alerts.turnOff();

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: false });
  });

  it.each([[false], ["throws"]] as const)(
    "stays on, and says so, when the browser will not unsubscribe (%s)",
    async (unsubscribeResult) => {
      const { alerts } = setUp({ permission: "granted", held: true, unsubscribeResult });
      await alerts.start();

      await alerts.turnOff();

      expect(api.removePushSubscription).not.toHaveBeenCalled();
      expect(alerts.getSnapshot()).toEqual({ type: "ready", on: true, busy: false, failed: true });
    },
  );

  it("is off, and tells the Worker nothing, when the browser holds no subscription", async () => {
    const { alerts } = setUp({ permission: "granted", held: false });

    await alerts.turnOff();

    expect(api.removePushSubscription).not.toHaveBeenCalled();
    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: false });
  });
});

describe("start, on every app load", () => {
  it("sends a subscription the browser holds to the Worker again and shows alerts on", async () => {
    const { alerts } = setUp({ permission: "granted", held: true });

    await alerts.start();

    expect(api.savePushSubscription).toHaveBeenCalledExactlyOnceWith({
      endpoint: ENDPOINT,
      keys: KEYS,
    });
    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: true, busy: false, failed: false });
  });

  it("is busy until it knows whether the browser holds a subscription", async () => {
    const { alerts, manager } = setUp({ permission: "granted", held: true });
    const held = Promise.withResolvers<PushSubscriptionHandle | null>();
    manager.getSubscription.mockReturnValue(held.promise);

    const started = alerts.start();
    await vi.waitFor(() => {
      expect(alerts.getSnapshot()).toMatchObject({ busy: true });
    });

    held.resolve(null);
    await started;
    expect(alerts.getSnapshot()).toMatchObject({ busy: false });
  });

  it("shows alerts on even when sending to the Worker fails; the next load tries again", async () => {
    vi.mocked(api.savePushSubscription).mockResolvedValue(FAILED);
    const { alerts } = setUp({ permission: "granted", held: true });

    await alerts.start();

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: true, busy: false, failed: false });
  });

  it("shows alerts off, and sends nothing, when the browser holds no subscription", async () => {
    const { alerts } = setUp({ permission: "granted", held: false });

    await alerts.start();

    expect(api.savePushSubscription).not.toHaveBeenCalled();
    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: false });
  });

  it("shows alerts off when the held subscription is not one the Worker accepts", async () => {
    const { alerts } = setUp({
      permission: "granted",
      held: true,
      json: { endpoint: "https://evil.example/x", keys: KEYS },
    });

    await alerts.start();

    expect(api.savePushSubscription).not.toHaveBeenCalled();
    expect(alerts.getSnapshot()).toMatchObject({ on: false });
  });

  it("shows alerts off when the service worker never becomes ready", async () => {
    vi.useFakeTimers();
    const { alerts } = setUp({ permission: "granted", workerNeverReady: true });

    const started = alerts.start();
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
    await started;

    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: false });
  });

  it("only fetches the key while permission is still to be asked", async () => {
    const { alerts, environment } = setUp({ permission: "default" });

    await alerts.start();

    expect(api.fetchPushKey).toHaveBeenCalledTimes(1);
    expect(environment.pushManager).not.toHaveBeenCalled();
    expect(alerts.getSnapshot()).toEqual({ type: "ready", on: false, busy: false, failed: false });
  });

  it.each([
    ["blocked", { permission: "denied" }],
    ["unavailable", { availability: "unavailable" }],
    ["needs_install", { availability: "needs_install" }],
  ] as const)("leaves a %s browser alone", async (type, options) => {
    const { alerts, environment } = setUp(options);

    await alerts.start();

    expect(alerts.getSnapshot()).toEqual({ type });
    expect(environment.pushManager).not.toHaveBeenCalled();
    expect(api.fetchPushKey).not.toHaveBeenCalled();
  });
});

describe("availabilityOf", () => {
  const desktop: BrowserFacts = {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 0,
    installed: false,
    hasPushApi: true,
  };
  const iphone: BrowserFacts = {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15",
    platform: "iPhone",
    maxTouchPoints: 5,
    installed: false,
    hasPushApi: false,
  };

  it("is available in a browser with the Push API", () => {
    expect(availabilityOf(desktop)).toBe("available");
  });

  it("is unavailable in a browser without it", () => {
    expect(availabilityOf({ ...desktop, hasPushApi: false })).toBe("unavailable");
  });

  it("asks an iPhone in Safari to install the app first", () => {
    expect(availabilityOf(iphone)).toBe("needs_install");
  });

  it("asks an iPad, which calls itself a Mac with a touch screen, to install the app first", () => {
    expect(availabilityOf({ ...desktop, maxTouchPoints: 5 })).toBe("needs_install");
  });

  it("asks an iPod and an iPad by name to install the app first", () => {
    expect(availabilityOf({ ...iphone, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4)" })).toBe(
      "needs_install",
    );
    expect(availabilityOf({ ...iphone, userAgent: "Mozilla/5.0 (iPod touch; iPhone OS)" })).toBe(
      "needs_install",
    );
  });

  it("is available on an iPhone once the app is installed and has the Push API", () => {
    expect(availabilityOf({ ...iphone, installed: true, hasPushApi: true })).toBe("available");
  });

  it("is unavailable on an installed iPhone too old for the Push API", () => {
    expect(availabilityOf({ ...iphone, installed: true })).toBe("unavailable");
  });

  it("is available on a Mac without a touch screen even when the app is not installed", () => {
    expect(availabilityOf({ ...desktop, maxTouchPoints: 1 })).toBe("available");
  });
});
