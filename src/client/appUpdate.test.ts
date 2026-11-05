import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppUpdate,
  type AppUpdateEnvironment,
  type ServiceWorkerHandle,
  type ServiceWorkerRegistrationHandle,
} from "./appUpdate";

const HOUR_MS = 60 * 60 * 1000;

type Listener = () => void;

function setUp(options: { waitingAtRegister?: boolean; updateFails?: boolean } = {}) {
  const listeners = new Map<string, Listener>();
  const registration = {
    waiting: options.waitingAtRegister === true ? {} : null,
    unregister: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  } satisfies ServiceWorkerRegistrationHandle;
  const worker = {
    register: vi.fn<ServiceWorkerHandle["register"]>().mockResolvedValue(registration),
    update: vi.fn<ServiceWorkerHandle["update"]>(() =>
      options.updateFails === true ? Promise.reject(new Error("offline")) : Promise.resolve(),
    ),
    messageSkipWaiting: vi.fn<() => void>(),
    addEventListener: vi.fn<ServiceWorkerHandle["addEventListener"]>((type, listener) => {
      listeners.set(type, listener);
    }),
  } satisfies ServiceWorkerHandle;
  let becameVisible: Listener | undefined;
  const environment = {
    worker,
    deleteCaches: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    reload: vi.fn<() => void>(),
    onBecameVisible: vi.fn<AppUpdateEnvironment["onBecameVisible"]>((listener) => {
      becameVisible = listener;
    }),
  } satisfies AppUpdateEnvironment;

  return {
    appUpdate: createAppUpdate(environment),
    environment,
    worker,
    registration,
    fire: (type: string) => listeners.get(type)?.(),
    becomeVisible: () => becameVisible?.(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createAppUpdate", () => {
  it("does nothing without a service worker, and applying clears the caches and reloads", async () => {
    const environment = {
      worker: undefined,
      deleteCaches: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      reload: vi.fn<() => void>(),
      onBecameVisible: vi.fn<AppUpdateEnvironment["onBecameVisible"]>(),
    } satisfies AppUpdateEnvironment;
    const appUpdate = createAppUpdate(environment);

    await appUpdate.start();
    await appUpdate.apply();

    expect(environment.onBecameVisible).not.toHaveBeenCalled();
    expect(appUpdate.getSnapshot()).toBe(false);
    expect(environment.deleteCaches).toHaveBeenCalledTimes(1);
    expect(environment.reload).toHaveBeenCalledTimes(1);
  });

  it("registers the worker once started, with no update waiting", async () => {
    const { appUpdate, worker } = setUp();

    await appUpdate.start();

    expect(worker.register).toHaveBeenCalledTimes(1);
    expect(appUpdate.getSnapshot()).toBe(false);
  });

  it("reports an update when the worker says one is waiting, and tells every subscriber", async () => {
    const { appUpdate, fire } = setUp();
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    appUpdate.subscribe(first);
    appUpdate.subscribe(second);
    await appUpdate.start();

    fire("waiting");

    expect(appUpdate.getSnapshot()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops telling a subscriber that unsubscribed", async () => {
    const { appUpdate, fire } = setUp();
    const listener = vi.fn<() => void>();
    const unsubscribe = appUpdate.subscribe(listener);
    await appUpdate.start();

    unsubscribe();
    fire("waiting");

    expect(listener).not.toHaveBeenCalled();
  });

  it("reports an update that was already waiting when the page loaded", async () => {
    const { appUpdate } = setUp({ waitingAtRegister: true });

    await appUpdate.start();

    expect(appUpdate.getSnapshot()).toBe(true);
  });

  it("checks for an update when the page becomes visible and every hour", async () => {
    const { appUpdate, worker, becomeVisible } = setUp();
    await appUpdate.start();
    expect(worker.update).not.toHaveBeenCalled();

    becomeVisible();
    expect(worker.update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR_MS - 1);
    expect(worker.update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(worker.update).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(worker.update).toHaveBeenCalledTimes(3);
  });

  it("carries on when a check fails, as it does offline", async () => {
    const { appUpdate, worker, becomeVisible } = setUp({ updateFails: true });
    await appUpdate.start();

    becomeVisible();
    await vi.advanceTimersByTimeAsync(HOUR_MS);

    expect(worker.update).toHaveBeenCalledTimes(2);
  });

  it("applies a waiting update by telling it to take over, and reloads once it has", async () => {
    const { appUpdate, worker, registration, environment, fire } = setUp({
      waitingAtRegister: true,
    });
    await appUpdate.start();

    await appUpdate.apply();

    expect(worker.update).toHaveBeenCalledTimes(1);
    expect(worker.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(registration.unregister).not.toHaveBeenCalled();
    expect(environment.deleteCaches).not.toHaveBeenCalled();
    expect(environment.reload).not.toHaveBeenCalled();

    fire("controlling");

    expect(environment.reload).toHaveBeenCalledTimes(1);
  });

  it("still applies a waiting update when the check for a newer one fails", async () => {
    const { appUpdate, worker } = setUp({ waitingAtRegister: true, updateFails: true });
    await appUpdate.start();

    await appUpdate.apply();

    expect(worker.messageSkipWaiting).toHaveBeenCalledTimes(1);
  });

  it("with nothing waiting, applying removes the worker and the caches, then reloads", async () => {
    const { appUpdate, worker, registration, environment } = setUp();
    await appUpdate.start();

    await appUpdate.apply();

    expect(worker.update).toHaveBeenCalledTimes(1);
    expect(worker.messageSkipWaiting).not.toHaveBeenCalled();
    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(environment.deleteCaches).toHaveBeenCalledTimes(1);
    expect(environment.reload).toHaveBeenCalledTimes(1);
  });

  it("applying before the worker has registered still clears the caches and reloads", async () => {
    const { appUpdate, worker, environment } = setUp();

    await appUpdate.apply();

    expect(worker.update).not.toHaveBeenCalled();
    expect(environment.deleteCaches).toHaveBeenCalledTimes(1);
    expect(environment.reload).toHaveBeenCalledTimes(1);
  });
});
