import { useSyncExternalStore } from "react";

import { pushSubscriptionSchema } from "../shared/api";
import { fetchPushKey, removePushSubscription, savePushSubscription } from "./api";

/** What a page needs to know about "your turn" alerts, and how to switch them on and off. */
export interface TurnAlerts {
  /**
   * Re-checks the browser's subscription on app load: one that exists is sent to the Worker again,
   * so the Worker's copy never lags behind the browser's.
   */
  start: () => Promise<void>;
  /**
   * Asks permission, subscribes the browser and tells the Worker. Call it straight from the user's
   * tap: browsers refuse the permission prompt anywhere else, and the prompt is the first thing
   * this does.
   */
  turnOn: () => Promise<void>;
  /** Unsubscribes the browser and tells the Worker. */
  turnOff: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => TurnAlertsState;
}

export type TurnAlertsState =
  /** No service worker or Push API here. */
  | { type: "unavailable" }
  /** iOS or iPadOS Safari outside an installed home-screen app, which has no Push API. */
  | { type: "needs_install" }
  /** The user refused notifications for this site, and only the browser's settings can undo that. */
  | { type: "blocked" }
  | {
      type: "ready";
      on: boolean;
      /** A request is in flight; the switch must not be toggled again. */
      busy: boolean;
      /** The last attempt to turn alerts on or off did not work. */
      failed: boolean;
    };

/** Whether this browser can offer alerts, as far as its features and install state tell. */
export type TurnAlertsAvailability = "available" | "needs_install" | "unavailable";

export type NotificationPermissionState = "default" | "granted" | "denied";

/** The parts of the page and browser that `createTurnAlerts` uses. */
export interface TurnAlertsEnvironment {
  availability: TurnAlertsAvailability;
  permission(): NotificationPermissionState;
  requestPermission(): Promise<NotificationPermissionState>;
  /** Resolves once the app's service worker is active, so it may never resolve. */
  pushManager(): Promise<PushManagerHandle>;
}

/** The part of a `PushManager` that `createTurnAlerts` uses. */
export interface PushManagerHandle {
  getSubscription(): Promise<PushSubscriptionHandle | null>;
  subscribe(options: {
    userVisibleOnly: true;
    applicationServerKey: string;
  }): Promise<PushSubscriptionHandle>;
}

/** The part of a `PushSubscription` that `createTurnAlerts` uses. */
export interface PushSubscriptionHandle {
  endpoint: string;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
}

/** What `availabilityOf` reads from the browser. */
export interface BrowserFacts {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Running as an installed app (home-screen icon), not in a browser tab. */
  installed: boolean;
  /** A service worker, the Push API and notifications are all there. */
  hasPushApi: boolean;
}

// Waiting for the service worker has no end if it never registered, such as in a private window.
// Ten seconds is long enough for a slow first start and short of leaving the switch stuck.
const WORKER_TIMEOUT_MS = 10_000;

export function createTurnAlerts(environment: TurnAlertsEnvironment): TurnAlerts {
  const listeners = new Set<() => void>();
  let state = initialState(environment);
  let publicKey: string | undefined;

  function setState(next: TurnAlertsState): void {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function setReady(change: { on?: boolean; busy: boolean; failed?: boolean }): void {
    if (state.type === "ready") {
      setState({ ...state, failed: false, ...change });
    }
  }

  async function start(): Promise<void> {
    if (state.type !== "ready") {
      return;
    }

    const permission = environment.permission();
    if (permission === "default") {
      // Fetched now so that the tap that turns alerts on goes from the prompt to subscribing
      // without a network wait in between, which Safari may not allow.
      void loadPublicKey();
      return;
    }

    setReady({ busy: true });
    const held = await currentSubscription();
    const body = pushSubscriptionSchema.safeParse(held?.toJSON());
    setReady({ on: body.success, busy: false });
    if (body.success) {
      // A failed save is not an error to show: the next load tries again.
      await savePushSubscription(body.data);
    }
  }

  async function turnOn(): Promise<void> {
    if (state.type !== "ready" || state.busy) {
      return;
    }

    setReady({ busy: true });
    let permission: NotificationPermissionState;
    try {
      permission = await environment.requestPermission();
    } catch {
      setReady({ busy: false, failed: true });
      return;
    }

    if (permission === "denied") {
      setState({ type: "blocked" });
      return;
    }
    if (permission === "default") {
      // The prompt was dismissed without an answer.
      setReady({ busy: false });
      return;
    }

    const on = await subscribeAndSave();
    setReady({ on, busy: false, failed: !on });
  }

  async function turnOff(): Promise<void> {
    if (state.type !== "ready" || state.busy) {
      return;
    }

    setReady({ busy: true });
    const unsubscribed = await unsubscribeAndForget();
    setReady({ on: !unsubscribed, busy: false, failed: !unsubscribed });
  }

  async function subscribeAndSave(): Promise<boolean> {
    const key = publicKey ?? (await loadPublicKey());
    if (key === undefined) {
      return false;
    }

    let subscription: PushSubscriptionHandle;
    try {
      const manager = await withinTime(environment.pushManager(), WORKER_TIMEOUT_MS);
      subscription = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch {
      // Brave without "Use Google services for push messaging" throws here, as does a browser
      // that cannot reach its push service.
      return false;
    }

    const body = pushSubscriptionSchema.safeParse(subscription.toJSON());
    if (body.success && (await savePushSubscription(body.data)).ok) {
      return true;
    }

    // Keep the browser and the Worker agreeing: no subscription on one side without the other.
    await subscription.unsubscribe().catch(() => false);

    return false;
  }

  /**
   * Unsubscribes the browser, then tells the Worker. If only the Worker call fails, the browser is
   * already off and the Worker's copy is deleted the next time a push to it answers 404 or 410.
   */
  async function unsubscribeAndForget(): Promise<boolean> {
    const held = await currentSubscription();
    if (held === undefined) {
      return true;
    }
    if (!(await held.unsubscribe().catch(() => false))) {
      return false;
    }

    await removePushSubscription(held.endpoint);

    return true;
  }

  async function currentSubscription(): Promise<PushSubscriptionHandle | undefined> {
    try {
      const manager = await withinTime(environment.pushManager(), WORKER_TIMEOUT_MS);

      return (await manager.getSubscription()) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async function loadPublicKey(): Promise<string | undefined> {
    const result = await fetchPushKey();
    if (result.ok) {
      publicKey = result.value.publicKey;
    }

    return publicKey;
  }

  return {
    start,
    turnOn,
    turnOff,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
  };
}

/**
 * Whether the browser can offer alerts. iOS and iPadOS Safari outside an installed app has no Push
 * API but gains one once the app is on the home screen, so it is told apart from a browser that
 * never will.
 */
export function availabilityOf(facts: BrowserFacts): TurnAlertsAvailability {
  if (isAppleTouchDevice(facts) && !facts.installed) {
    return "needs_install";
  }

  return facts.hasPushApi ? "available" : "unavailable";
}

/** Re-checks the browser's subscription, in a production build of a browser that has the Push API. */
export function startTurnAlerts(): Promise<void> {
  return browserTurnAlerts().start();
}

/** The alerts state of this browser, and the functions that change it. */
export function useTurnAlerts(): {
  state: TurnAlertsState;
  turnOn: () => Promise<void>;
  turnOff: () => Promise<void>;
} {
  const alerts = browserTurnAlerts();
  const state = useSyncExternalStore(alerts.subscribe, alerts.getSnapshot);

  return { state, turnOn: alerts.turnOn, turnOff: alerts.turnOff };
}

function initialState(environment: TurnAlertsEnvironment): TurnAlertsState {
  if (environment.availability !== "available") {
    return { type: environment.availability };
  }

  return environment.permission() === "denied"
    ? { type: "blocked" }
    : { type: "ready", on: false, busy: false, failed: false };
}

// iPadOS 13 and later reports itself as a Mac, so a Mac with a touch screen is an iPad.
function isAppleTouchDevice(facts: BrowserFacts): boolean {
  return (
    /iPhone|iPad|iPod/.test(facts.userAgent) ||
    (facts.platform === "MacIntel" && facts.maxTouchPoints > 1)
  );
}

// Created on first use, because it reads `navigator`, which the test and server environments may lack.
let browserInstance: TurnAlerts | undefined;

function browserTurnAlerts(): TurnAlerts {
  browserInstance ??= createTurnAlerts(browserEnvironment());

  return browserInstance;
}

function browserEnvironment(): TurnAlertsEnvironment {
  const hasPushApi =
    process.env.NODE_ENV === "production" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  return {
    availability: availabilityOf({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      installed: isInstalled(),
      hasPushApi,
    }),
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    pushManager: async () => (await navigator.serviceWorker.ready).pushManager,
  };
}

// `navigator.standalone` is Safari's own flag, absent from the DOM typings.
function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true)
  );
}

async function withinTime<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`No answer within ${ms.toString()} ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
