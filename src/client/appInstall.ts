import { useSyncExternalStore } from "react";
import { z } from "zod";

import { isInstalled } from "./browserFacts";

/** Whether the page can offer to install the app, and whether the browser's install dialog is open. */
export type AppInstallState = { type: "unavailable" } | { type: "ready"; busy: boolean };

/** What a page needs to offer installing the app, and the function that does it. */
export interface AppInstall {
  /** Starts listening for the browser's offer to install the app. Call it once, as the page loads. */
  start: () => void;
  /** Opens the browser's install dialog. Does nothing unless an offer is waiting and no dialog is open. */
  install: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AppInstallState;
}

/** The parts of the page and browser that `createAppInstall` uses. */
export interface AppInstallEnvironment {
  /** Calls the listener each time the browser offers to install the app. */
  onPromptOffered: (listener: (prompt: InstallPrompt) => void) => void;
  /** Calls the listener when the app has been installed. */
  onInstalled: (listener: () => void) => void;
  /** True when the page already runs as an installed app. */
  installed: () => boolean;
}

/** An offer from the browser to install the app. */
export interface InstallPrompt {
  /** Opens the browser's install dialog and says what the reader chose. */
  show: () => Promise<"accepted" | "dismissed">;
}

// `BeforeInstallPromptEvent` is not in the DOM typings.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
}

const UNAVAILABLE: AppInstallState = { type: "unavailable" };

export function createAppInstall(environment: AppInstallEnvironment): AppInstall {
  const listeners = new Set<() => void>();
  let state: AppInstallState = UNAVAILABLE;
  let prompt: InstallPrompt | undefined;
  let started = false;

  function setState(next: AppInstallState): void {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function start(): void {
    if (started) {
      return;
    }

    started = true;
    environment.onPromptOffered((offered) => {
      if (environment.installed()) {
        return;
      }

      prompt = offered;
      setState({ type: "ready", busy: false });
    });
    environment.onInstalled(() => {
      prompt = undefined;
      setState(UNAVAILABLE);
    });
  }

  async function install(): Promise<void> {
    if (prompt === undefined || (state.type === "ready" && state.busy)) {
      return;
    }

    const offered = prompt;
    setState({ type: "ready", busy: true });

    try {
      await offered.show();
    } catch {
      // The browser refused to open the dialog. Offering again would fail the same way.
    }

    // A browser offer works once, whichever way the reader answers. Chrome offers again on a later load.
    prompt = undefined;
    setState(UNAVAILABLE);
  }

  return {
    start,
    install,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
  };
}

/** Starts listening for the browser's offer to install the app, in a production build. */
export function startAppInstall(): void {
  browserAppInstall().start();
}

/** Whether the app can be installed from this page, and the function that starts the install. */
export function useAppInstall(): { state: AppInstallState; install: () => Promise<void> } {
  const appInstall = browserAppInstall();
  const state = useSyncExternalStore(appInstall.subscribe, appInstall.getSnapshot);

  return { state, install: appInstall.install };
}

// Created on first use, because it reads `window`, which the test and server environments may lack.
let browserInstance: AppInstall | undefined;

function browserAppInstall(): AppInstall {
  browserInstance ??= createAppInstall(browserEnvironment());

  return browserInstance;
}

function browserEnvironment(): AppInstallEnvironment {
  // Development and test builds have no installable app, so they never listen.
  const listens = process.env.NODE_ENV === "production";

  return {
    onPromptOffered: (listener) => {
      if (!listens) {
        return;
      }

      window.addEventListener("beforeinstallprompt", (event) => {
        if (!isInstallPromptEvent(event)) {
          return;
        }

        // Without this the browser shows its own install bar beside our button.
        event.preventDefault();
        listener({ show: () => showInstallPrompt(event) });
      });
    },
    onInstalled: (listener) => {
      if (listens) {
        window.addEventListener("appinstalled", listener);
      }
    },
    installed: isInstalled,
  };
}

function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

const userChoiceSchema = z.object({ outcome: z.enum(["accepted", "dismissed"]) });

export async function showInstallPrompt(
  event: Pick<InstallPromptEvent, "prompt" | "userChoice">,
): Promise<"accepted" | "dismissed"> {
  await event.prompt();

  return userChoiceSchema.parse(await event.userChoice).outcome;
}
