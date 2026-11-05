import { Serwist } from "@serwist/window";
import { useSyncExternalStore } from "react";

/** What a page needs to know about a newer version of the app, and how to switch to it. */
export interface AppUpdate {
  /** Registers the web app's service worker and starts looking for a newer version. */
  start: () => Promise<void>;
  /**
   * Switches to the newer version and reloads. With none waiting, or one that does not take over
   * in time, it clears the service worker and its caches and reloads, so the page comes fresh from
   * the network.
   */
  apply: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  /** True while a newer version has been downloaded and is waiting to be applied. */
  getSnapshot: () => boolean;
}

/** The parts of the page and browser that `createAppUpdate` uses. */
export interface AppUpdateEnvironment {
  /** Undefined when there is no service worker to use, such as in development. */
  worker: ServiceWorkerHandle | undefined;
  deleteCaches(): Promise<void>;
  reload(): void;
  /** Calls the listener each time the page becomes visible again. */
  onBecameVisible(listener: () => void): void;
}

/** The part of `@serwist/window`'s `Serwist` that `createAppUpdate` uses. */
export interface ServiceWorkerHandle {
  register: () => Promise<ServiceWorkerRegistrationHandle | undefined>;
  update: () => Promise<void>;
  messageSkipWaiting: () => void;
  addEventListener: (type: "waiting" | "controlling", listener: () => void) => void;
}

/** The part of a `ServiceWorkerRegistration` that `createAppUpdate` uses. */
export interface ServiceWorkerRegistrationHandle {
  /** Set while a newer worker has installed and is waiting to take over. */
  waiting: object | null;
  /** Set while a newer worker has been found and is still downloading its files. */
  installing: {
    state: string;
    addEventListener: (type: "statechange", listener: () => void) => void;
  } | null;
  unregister: () => Promise<boolean>;
}

// "Update now" must never leave the user with a dead button. Taking over, once the waiting build is
// told to, is local work that finishes in well under a second. Ten seconds is long enough for a slow
// phone and short enough that a user who has tapped is not left staring at a page that does nothing.
// A build found at the click gets the same time to finish downloading its files.
const HANDOVER_TIMEOUT_MS = 10_000;

// A page that stays open for days still finds out about a new build. Hourly is often enough to
// notice a release within a working session and rare enough to cost almost nothing.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function createAppUpdate(environment: AppUpdateEnvironment): AppUpdate {
  const { worker } = environment;
  const listeners = new Set<() => void>();
  let registration: ServiceWorkerRegistrationHandle | undefined;
  let waiting = false;

  function markWaiting(): void {
    waiting = true;
    for (const listener of listeners) {
      listener();
    }
  }

  async function checkForUpdate(): Promise<void> {
    try {
      await worker?.update();
    } catch {
      // Offline, or the server is down. The next check tries again.
    }
  }

  async function start(): Promise<void> {
    if (worker === undefined) {
      return;
    }

    worker.addEventListener("waiting", markWaiting);
    try {
      registration = await worker.register();
    } catch {
      // The browser refused the worker, such as in a private window or with site data blocked. The
      // app works without it, only not offline, so there is nothing to tell the user.
      return;
    }

    if (registration?.waiting) {
      markWaiting();
    }

    environment.onBecameVisible(() => void checkForUpdate());
    setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
  }

  async function apply(): Promise<void> {
    if (worker !== undefined && registration !== undefined) {
      await checkForUpdate();
      await finishInstalling(registration);

      if (registration.waiting && (await handOver(worker))) {
        environment.reload();

        return;
      }
    }

    await registration?.unregister();
    await environment.deleteCaches();
    environment.reload();
  }

  return {
    start,
    apply,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => waiting,
  };
}

/**
 * Waits for a build found a moment ago to finish downloading. `update()` resolves when the build is
 * found, not when it is ready, so without this a user who taps just after a release gets the slow
 * clean reload instead of a handover.
 */
async function finishInstalling(registration: ServiceWorkerRegistrationHandle): Promise<void> {
  const { installing } = registration;
  if (registration.waiting || installing === null) {
    return;
  }

  const left = new Promise<void>((resolve) => {
    installing.addEventListener("statechange", () => {
      if (installing.state !== "installing") {
        resolve();
      }
    });
  });
  if (installing.state !== "installing") {
    return;
  }

  await settlesWithin(left, HANDOVER_TIMEOUT_MS);
}

/** Tells the waiting build to take over. False if it has not done so in time, such as when it vanished. */
async function handOver(handle: ServiceWorkerHandle): Promise<boolean> {
  const tookOver = new Promise<void>((resolve) => {
    handle.addEventListener("controlling", resolve);
  });
  handle.messageSkipWaiting();

  return settlesWithin(tookOver, HANDOVER_TIMEOUT_MS);
}

/** Registers the service worker, in a production build of a browser that has them. */
export function startAppUpdates(): Promise<void> {
  return browserAppUpdate().start();
}

/** Whether a newer version of the app is waiting, and the function that switches to it. */
export function useAppUpdate(): { updateReady: boolean; applyUpdate: () => Promise<void> } {
  const appUpdate = browserAppUpdate();
  const updateReady = useSyncExternalStore(appUpdate.subscribe, appUpdate.getSnapshot);

  return { updateReady, applyUpdate: appUpdate.apply };
}

// Created on first use, because it reads `navigator`, which the test and server environments may lack.
let browserInstance: AppUpdate | undefined;

function browserAppUpdate(): AppUpdate {
  browserInstance ??= createAppUpdate(browserEnvironment());

  return browserInstance;
}

function browserEnvironment(): AppUpdateEnvironment {
  const usesServiceWorker = process.env.NODE_ENV === "production" && "serviceWorker" in navigator;

  return {
    // Registered without `type: "module"`: the worker is a classic script (see buildServiceWorker.ts).
    worker: usesServiceWorker ? new Serwist("/sw.js", { scope: "/" }) : undefined,
    deleteCaches: deleteAllCaches,
    reload: () => {
      window.location.reload();
    },
    onBecameVisible: (listener) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          listener();
        }
      });
    },
  };
}

async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });

  try {
    return await Promise.race([promise.then(() => true as const), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function deleteAllCaches(): Promise<void> {
  if (!("caches" in globalThis)) {
    return;
  }

  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
}
