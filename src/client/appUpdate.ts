import { Serwist } from "@serwist/window";
import { useSyncExternalStore } from "react";

/** What a page needs to know about a newer version of the app, and how to switch to it. */
export interface AppUpdate {
  /** Registers the web app's service worker and starts looking for a newer version. */
  start: () => Promise<void>;
  /**
   * Switches to the newer version and reloads. With none waiting, it clears the service worker and
   * its caches and reloads, so the page comes fresh from the network.
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
  register: () => Promise<WorkerRegistration | undefined>;
  update: () => Promise<void>;
  messageSkipWaiting: () => void;
  addEventListener: (type: "waiting" | "controlling", listener: () => void) => void;
}

/** The part of a `ServiceWorkerRegistration` that `createAppUpdate` uses. */
export interface WorkerRegistration {
  /** Set while a newer worker has installed and is waiting to take over. */
  waiting: object | null;
  unregister: () => Promise<boolean>;
}

// A page that stays open for days still finds out about a new build. Hourly is often enough to
// notice a release within a working session and rare enough to cost almost nothing.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function createAppUpdate(environment: AppUpdateEnvironment): AppUpdate {
  const { worker } = environment;
  const listeners = new Set<() => void>();
  let registration: WorkerRegistration | undefined;
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
    registration = await worker.register();
    if (registration?.waiting) {
      markWaiting();
    }

    environment.onBecameVisible(() => void checkForUpdate());
    setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
  }

  async function apply(): Promise<void> {
    if (worker !== undefined && registration !== undefined) {
      await checkForUpdate();

      if (registration.waiting) {
        worker.addEventListener("controlling", () => {
          environment.reload();
        });
        worker.messageSkipWaiting();

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

async function deleteAllCaches(): Promise<void> {
  if (!("caches" in globalThis)) {
    return;
  }

  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
}
