import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

import { PHONE, names, startStory, turnBanner } from "./writers.ts";

// What these tests prove: the switch in the story rail, and the app's calls to the real Worker
// (key, PUT, DELETE) with the real service worker registered. What they cannot prove: a push
// reaching a browser. Headless Chromium reports `Notification.permission` as "denied" whatever the
// context grants, and it has no push service to subscribe to. The tests that need a browser that
// allows push therefore replace `Notification` and `PushManager` with a stand-in (see
// `standInForPushService`); they say so in their names.

const SWITCH_LABEL = "Notify me when it's my turn";
const DESKTOP = { width: 1280, height: 800 };
// The stand-in's endpoint hashed with SHA-256, worked out outside the app so the test pins the ID.
const SUBSCRIPTION_URL =
  "/api/push-subscriptions/7808440c3e662d81aa91e1de554cc170cdf741df06c8aea757aa550a09bfd663";

async function writerOn(
  browser: Browser,
  options: BrowserContextOptions = {},
  standIn = false,
): Promise<Page> {
  const context = await browser.newContext({
    viewport: DESKTOP,
    serviceWorkers: "allow",
    ...options,
  });
  const page = await context.newPage();
  if (standIn) {
    await standInForPushService(page);
  }
  await startStory(page, names.ana, "The lighthouse went dark at noon.");

  return page;
}

/**
 * Replaces the permission prompt and the browser's push subscription with a stand-in kept in
 * `localStorage`, so it survives a reload as the real one does. The page, the service worker and
 * the Worker are real.
 */
async function standInForPushService(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const subscriptionKey = "e2e-subscription";
    const subscription = () => {
      const endpoint = localStorage.getItem(subscriptionKey);
      if (endpoint === null) {
        return null;
      }

      return {
        endpoint,
        toJSON: () => ({
          endpoint,
          keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) },
        }),
        unsubscribe: () => {
          localStorage.removeItem(subscriptionKey);

          return Promise.resolve(true);
        },
      };
    };

    Object.defineProperty(Notification, "permission", {
      get: () => localStorage.getItem("e2e-permission") ?? "default",
    });
    Reflect.set(Notification, "requestPermission", () => {
      localStorage.setItem("e2e-permission", "granted");

      return Promise.resolve("granted");
    });
    Reflect.set(PushManager.prototype, "getSubscription", () => Promise.resolve(subscription()));
    Reflect.set(PushManager.prototype, "subscribe", () => {
      localStorage.setItem(subscriptionKey, "https://fcm.googleapis.com/fcm/send/e2e-stand-in");

      return Promise.resolve(subscription());
    });
  });
}

function notifySwitch(page: Page) {
  return page.getByRole("switch", { name: SWITCH_LABEL });
}

/** The switch sits in the rail directly under the turn banner (and its turn order). */
async function expectUnderTurnBanner(page: Page): Promise<void> {
  const banner = await turnBanner(page).boundingBox();
  const toggle = await notifySwitch(page).boundingBox();

  expect(banner).not.toBeNull();
  expect(toggle).not.toBeNull();
  expect(toggle?.y ?? 0).toBeGreaterThanOrEqual((banner?.y ?? 0) + (banner?.height ?? 0));
}

test("on a desktop screen the switch is in the rail under the turn banner", async ({ browser }) => {
  const page = await writerOn(browser);

  await expect(notifySwitch(page)).toBeVisible();
  await expectUnderTurnBanner(page);
  const rail = await notifySwitch(page).boundingBox();
  expect(rail?.x ?? Infinity).toBeLessThan(320);
});

test("on a phone the switch is under the turn banner", async ({ browser }) => {
  const page = await writerOn(browser, { viewport: PHONE });

  await expect(notifySwitch(page)).toBeVisible();
  await expectUnderTurnBanner(page);
});

test("with a stand-in for the push service: on sends the subscription, a reload sends it again, off deletes it", async ({
  browser,
}) => {
  const page = await writerOn(browser, {}, true);
  await expect(notifySwitch(page)).toBeEnabled();
  await expect(notifySwitch(page)).not.toBeChecked();

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(SUBSCRIPTION_URL) && response.request().method() === "PUT",
  );
  await notifySwitch(page).click();

  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(204);
  expect(savedResponse.request().postDataJSON()).toEqual({
    endpoint: "https://fcm.googleapis.com/fcm/send/e2e-stand-in",
    keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) },
  });
  await expect(notifySwitch(page)).toBeChecked();

  const savedAgain = page.waitForResponse(
    (response) =>
      response.url().endsWith(SUBSCRIPTION_URL) && response.request().method() === "PUT",
  );
  await page.reload();
  expect((await savedAgain).status()).toBe(204);
  await expect(notifySwitch(page)).toBeChecked();

  const removed = page.waitForResponse(
    (response) =>
      response.url().endsWith(SUBSCRIPTION_URL) && response.request().method() === "DELETE",
  );
  await notifySwitch(page).click();

  const removedResponse = await removed;
  expect(removedResponse.status()).toBe(204);
  expect(removedResponse.request().postData()).toBeNull();
  await expect(notifySwitch(page)).not.toBeChecked();
});
