import { describe, expect, it, vi } from "vitest";

import {
  createAppInstall,
  showInstallPrompt,
  type AppInstallEnvironment,
  type InstallPrompt,
} from "./appInstall";

function setUp(options: { installed?: boolean } = {}) {
  let offer: ((prompt: InstallPrompt) => void) | undefined;
  let installedListener: (() => void) | undefined;
  const environment = {
    onPromptOffered: vi.fn<AppInstallEnvironment["onPromptOffered"]>((listener) => {
      offer = listener;
    }),
    onInstalled: vi.fn<AppInstallEnvironment["onInstalled"]>((listener) => {
      installedListener = listener;
    }),
    installed: () => options.installed === true,
  } satisfies AppInstallEnvironment;
  const appInstall = createAppInstall(environment);
  appInstall.start();

  return {
    appInstall,
    environment,
    offer: (prompt: InstallPrompt) => offer?.(prompt),
    markInstalled: () => installedListener?.(),
  };
}

function promptThatAnswers(outcome: "accepted" | "dismissed") {
  return { show: vi.fn<InstallPrompt["show"]>().mockResolvedValue(outcome) };
}

/** A prompt whose dialog stays open until the test settles it. */
function promptThatWaits() {
  const dialog = Promise.withResolvers<"accepted" | "dismissed">();
  const show = vi.fn<InstallPrompt["show"]>(() => dialog.promise);

  return {
    show,
    settle: (outcome: "accepted" | "dismissed") => {
      dialog.resolve(outcome);
    },
    fail: (error: Error) => {
      dialog.reject(error);
    },
  };
}

describe("createAppInstall", () => {
  it("is unavailable until the browser makes an offer, and listens only once started", () => {
    const environment = {
      onPromptOffered: vi.fn<AppInstallEnvironment["onPromptOffered"]>(),
      onInstalled: vi.fn<AppInstallEnvironment["onInstalled"]>(),
      installed: () => false,
    } satisfies AppInstallEnvironment;
    const appInstall = createAppInstall(environment);

    expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
    expect(environment.onPromptOffered).not.toHaveBeenCalled();
    expect(environment.onInstalled).not.toHaveBeenCalled();

    appInstall.start();

    expect(environment.onPromptOffered).toHaveBeenCalledTimes(1);
    expect(environment.onInstalled).toHaveBeenCalledTimes(1);
    expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
  });

  it("is ready, and tells subscribers, when the browser makes an offer", () => {
    const { appInstall, offer } = setUp();
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    appInstall.subscribe(first);
    appInstall.subscribe(second);

    offer(promptThatAnswers("accepted"));

    expect(appInstall.getSnapshot()).toStrictEqual({ type: "ready", busy: false });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const { appInstall, offer } = setUp();
    const listener = vi.fn<() => void>();
    const unsubscribe = appInstall.subscribe(listener);

    unsubscribe();
    offer(promptThatAnswers("accepted"));

    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores an offer when the app is already installed", async () => {
    const { appInstall, offer } = setUp({ installed: true });
    const prompt = promptThatAnswers("accepted");
    const listener = vi.fn<() => void>();
    appInstall.subscribe(listener);

    offer(prompt);
    await appInstall.install();

    expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
    expect(listener).not.toHaveBeenCalled();
    expect(prompt.show).not.toHaveBeenCalled();
  });

  it.each(["accepted", "dismissed"] as const)(
    "shows the dialog, is busy while it is open, then is unavailable when it is %s",
    async (outcome) => {
      const { appInstall, offer } = setUp();
      const prompt = promptThatWaits();
      offer(prompt);

      const installing = appInstall.install();

      expect(prompt.show).toHaveBeenCalledTimes(1);
      expect(appInstall.getSnapshot()).toStrictEqual({ type: "ready", busy: true });

      prompt.settle(outcome);
      await installing;

      expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
    },
  );

  it("shows the dialog once when the button is pressed twice", async () => {
    const { appInstall, offer } = setUp();
    const prompt = promptThatWaits();
    offer(prompt);

    const first = appInstall.install();
    await appInstall.install();
    prompt.settle("dismissed");
    await first;

    expect(prompt.show).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an offer", async () => {
    const { appInstall } = setUp();
    const listener = vi.fn<() => void>();
    appInstall.subscribe(listener);

    await appInstall.install();

    expect(listener).not.toHaveBeenCalled();
    expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
  });

  it("does not show a used offer again", async () => {
    const { appInstall, offer } = setUp();
    const prompt = promptThatAnswers("dismissed");
    offer(prompt);
    await appInstall.install();

    await appInstall.install();

    expect(prompt.show).toHaveBeenCalledTimes(1);
  });

  it("takes a later offer after the first was used", async () => {
    const { appInstall, offer } = setUp();
    offer(promptThatAnswers("dismissed"));
    await appInstall.install();
    const second = promptThatAnswers("accepted");

    offer(second);
    await appInstall.install();

    expect(second.show).toHaveBeenCalledTimes(1);
    expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
  });

  it("falls back to unavailable, not a stuck busy button, when the dialog fails to open", async () => {
    const { appInstall, offer } = setUp();
    const prompt = promptThatWaits();
    offer(prompt);

    const installing = appInstall.install();
    prompt.fail(new Error("refused"));

    await expect(installing).resolves.toBeUndefined();
    expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
  });

  it("is unavailable once the app has been installed, and the old offer is dropped", async () => {
    const { appInstall, offer, markInstalled } = setUp();
    const prompt = promptThatAnswers("accepted");
    offer(prompt);
    const listener = vi.fn<() => void>();
    appInstall.subscribe(listener);

    markInstalled();
    await appInstall.install();

    expect(appInstall.getSnapshot()).toStrictEqual({ type: "unavailable" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(prompt.show).not.toHaveBeenCalled();
  });
});

describe("showInstallPrompt", () => {
  it.each(["accepted", "dismissed"] as const)(
    "opens the dialog and returns the reader's choice when it is %s",
    async (outcome) => {
      const prompt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

      const shown = await showInstallPrompt({ prompt, userChoice: Promise.resolve({ outcome }) });

      expect(prompt).toHaveBeenCalledTimes(1);
      expect(shown).toBe(outcome);
    },
  );

  it.each([{ outcome: "maybe" }, {}])("rejects the unreadable choice %j", async (choice) => {
    const prompt = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await expect(
      showInstallPrompt({ prompt, userChoice: Promise.resolve(choice) }),
    ).rejects.toThrow(/outcome/);
  });
});
