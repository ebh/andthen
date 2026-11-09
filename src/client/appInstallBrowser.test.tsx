// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test needs a fresh module: the browser's install object is created on first use and kept.
async function loadAppInstall() {
  vi.resetModules();

  return import("./appInstall");
}

function stubDisplayMode(standalone: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(display-mode: standalone)" && standalone,
  }));
}

/** Stands in for the browser's `BeforeInstallPromptEvent`, which jsdom lacks. */
function installPromptEvent(userChoice: unknown = { outcome: "accepted" }) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve(userChoice) });

  return { event, prompt };
}

// The listeners a test's module adds to `window` must not outlive it, or the next test's events
// reach the old module as well.
const added: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  const addEventListener = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    added.push([type, listener]);
    addEventListener(type, listener, options);
  });
});

afterEach(() => {
  for (const [type, listener] of added.splice(0)) {
    window.removeEventListener(type, listener);
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("useAppInstall", () => {
  it("offers the install once the browser makes an offer, opens its dialog, and clears when installed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubDisplayMode(false);
    const { startAppInstall, useAppInstall } = await loadAppInstall();
    const { result } = renderHook(() => useAppInstall());
    startAppInstall();
    expect(result.current.state).toStrictEqual({ type: "unavailable" });
    const { event, prompt } = installPromptEvent();

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(result.current.state).toStrictEqual({ type: "ready", busy: false });

    await act(async () => {
      await result.current.install();
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current.state).toStrictEqual({ type: "unavailable" });

    act(() => {
      window.dispatchEvent(installPromptEvent().event);
    });
    expect(result.current.state).toStrictEqual({ type: "ready", busy: false });

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.state).toStrictEqual({ type: "unavailable" });
  });

  it("stays unavailable outside a production build", async () => {
    stubDisplayMode(false);
    const { startAppInstall, useAppInstall } = await loadAppInstall();
    const { result } = renderHook(() => useAppInstall());
    startAppInstall();
    const { event } = installPromptEvent();

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(result.current.state).toStrictEqual({ type: "unavailable" });
    expect(added.map(([type]) => type)).not.toContain("beforeinstallprompt");
    expect(added.map(([type]) => type)).not.toContain("appinstalled");
  });

  it("ignores an offer when the app already runs in its own window", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubDisplayMode(true);
    const { startAppInstall, useAppInstall } = await loadAppInstall();
    const { result } = renderHook(() => useAppInstall());
    startAppInstall();

    act(() => {
      window.dispatchEvent(installPromptEvent().event);
    });

    expect(result.current.state).toStrictEqual({ type: "unavailable" });
  });

  it("ignores an event that has no install prompt, and leaves the browser's own handling alone", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubDisplayMode(false);
    const { startAppInstall, useAppInstall } = await loadAppInstall();
    const { result } = renderHook(() => useAppInstall());
    startAppInstall();
    const withoutPrompt = new Event("beforeinstallprompt", { cancelable: true });
    const promptNotAFunction = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(promptNotAFunction, { prompt: "yes" });

    act(() => {
      window.dispatchEvent(withoutPrompt);
      window.dispatchEvent(promptNotAFunction);
    });

    expect(withoutPrompt.defaultPrevented).toBe(false);
    expect(promptNotAFunction.defaultPrevented).toBe(false);
    expect(result.current.state).toStrictEqual({ type: "unavailable" });
  });

  it("falls back to unavailable when the reader's choice cannot be read", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubDisplayMode(false);
    const { startAppInstall, useAppInstall } = await loadAppInstall();
    const { result } = renderHook(() => useAppInstall());
    startAppInstall();

    act(() => {
      window.dispatchEvent(installPromptEvent({ outcome: "maybe" }).event);
    });
    await act(async () => {
      await result.current.install();
    });

    expect(result.current.state).toStrictEqual({ type: "unavailable" });
  });
});
