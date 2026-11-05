// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serwists = vi.hoisted(() => {
  class FakeSerwist {
    readonly listeners = new Map<string, () => void>();
    readonly register = vi.fn<
      () => Promise<{
        waiting: object | null;
        installing: null;
        unregister: () => Promise<boolean>;
      }>
    >(() =>
      Promise.resolve({
        waiting: state.updateWaiting ? {} : null,
        installing: null,
        unregister: () => Promise.resolve(true),
      }),
    );
    readonly update = vi.fn<() => Promise<void>>(() => Promise.resolve());
    readonly messageSkipWaiting = vi.fn<() => void>();

    constructor(
      readonly scriptUrl: string,
      readonly options: object,
    ) {
      instances.push(this);
    }

    addEventListener(type: string, listener: () => void): void {
      this.listeners.set(type, listener);
    }
  }

  const instances: FakeSerwist[] = [];
  const state = { updateWaiting: false };

  return { FakeSerwist, instances, state };
});

vi.mock("@serwist/window", () => ({ Serwist: serwists.FakeSerwist }));

// Each test needs a fresh module: the browser's update object is created on first use and kept.
async function loadAppUpdate() {
  vi.resetModules();

  return import("./appUpdate");
}

function supportServiceWorkers(): void {
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
}

let reload: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  serwists.instances.length = 0;
  serwists.state.updateWaiting = false;
  reload = vi.fn<() => void>();
  vi.stubGlobal("location", { reload });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("startAppUpdates", () => {
  it("registers no service worker outside a production build", async () => {
    supportServiceWorkers();
    const { startAppUpdates } = await loadAppUpdate();

    await startAppUpdates();

    expect(serwists.instances).toHaveLength(0);
  });

  it("registers no service worker in a browser without them", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { startAppUpdates } = await loadAppUpdate();

    await startAppUpdates();

    expect(serwists.instances).toHaveLength(0);
  });

  it("registers /sw.js as a classic script for the whole site in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    supportServiceWorkers();
    const { startAppUpdates } = await loadAppUpdate();

    await startAppUpdates();

    expect(serwists.instances).toHaveLength(1);
    expect(serwists.instances[0]?.scriptUrl).toBe("/sw.js");
    expect(serwists.instances[0]?.options).toStrictEqual({ scope: "/" });
    expect(serwists.instances[0]?.register).toHaveBeenCalledTimes(1);
  });

  it("checks for an update only when the page becomes visible", async () => {
    vi.stubEnv("NODE_ENV", "production");
    supportServiceWorkers();
    const { startAppUpdates } = await loadAppUpdate();
    await startAppUpdates();
    const worker = serwists.instances[0];
    const visibility = vi.spyOn(document, "visibilityState", "get");

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(worker?.update).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(worker?.update).toHaveBeenCalledTimes(1);
  });
});

describe("useAppUpdate", () => {
  it("reports that a newer version is waiting once the worker says so", async () => {
    vi.stubEnv("NODE_ENV", "production");
    supportServiceWorkers();
    const { startAppUpdates, useAppUpdate } = await loadAppUpdate();
    const { result } = renderHook(() => useAppUpdate());
    await startAppUpdates();
    expect(result.current.updateReady).toBe(false);

    act(() => {
      serwists.instances[0]?.listeners.get("waiting")?.();
    });

    expect(result.current.updateReady).toBe(true);
  });

  it("applies a waiting version by telling it to take over, and reloads when it has", async () => {
    vi.stubEnv("NODE_ENV", "production");
    supportServiceWorkers();
    serwists.state.updateWaiting = true;
    const { startAppUpdates, useAppUpdate } = await loadAppUpdate();
    const { result } = renderHook(() => useAppUpdate());
    await startAppUpdates();
    const worker = serwists.instances[0];

    const applied = result.current.applyUpdate();
    await vi.waitFor(() => {
      expect(worker?.messageSkipWaiting).toHaveBeenCalledTimes(1);
    });
    expect(reload).not.toHaveBeenCalled();

    worker?.listeners.get("controlling")?.();
    await applied;

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("without a service worker, applying deletes every cache and reloads", async () => {
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: () => Promise.resolve(["precache", "other"]),
      delete: (name: string) => {
        deleted.push(name);

        return Promise.resolve(true);
      },
    });
    const { useAppUpdate } = await loadAppUpdate();
    const { result } = renderHook(() => useAppUpdate());

    await result.current.applyUpdate();

    expect(deleted).toStrictEqual(["precache", "other"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("without cache storage, applying still reloads", async () => {
    vi.stubGlobal("caches", undefined);
    Reflect.deleteProperty(globalThis, "caches");
    const { useAppUpdate } = await loadAppUpdate();
    const { result } = renderHook(() => useAppUpdate());

    await result.current.applyUpdate();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
