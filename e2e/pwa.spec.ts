import { expect, test, type Page } from "@playwright/test";

import { startVersionProxy } from "./versionProxy.ts";

// The config blocks service workers so route mocks keep working; these tests are about the worker.
test.use({ serviceWorkers: "allow" });

test("the service worker registers and controls the page", async ({ page }) => {
  await page.goto("/");

  await expectControlled(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(
    /\/sw\.js$/,
  );
});

test("the app shell loads offline, on the start page and on a deep link", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expectControlled(page);

  await context.setOffline(true);

  await expectShellFromWorker(page, "/");
  await expectShellFromWorker(page, "/abcde");
});

test("legal pages are served as static pages, not the app shell", async ({ page }) => {
  await page.goto("/");
  await expectControlled(page);

  const current = await page.goto("/legal/privacy-policy");

  expect(current?.fromServiceWorker()).toBe(false);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  await expect(page).toHaveTitle(/^Privacy policy, version \d+$/);

  await page.goto("/legal/privacy-policy/v1");

  await expect(page).toHaveTitle("Privacy policy, version 1");
  await expect(page.getByText("Version 1 · Effective")).toBeVisible();
});

test("the API is never answered from the cache", async ({ page, context }) => {
  await page.goto("/");
  await expectControlled(page);
  expect(await fetchStatus(page, "/api/health")).toBe(200);

  await context.setOffline(true);

  expect(await fetchStatus(page, "/api/health")).toBe("network error");
});

test("a new version waits, is offered in a notice, and takes over when the user taps Update", async ({
  page,
  request,
  baseURL,
}) => {
  const proxy = await startVersionProxy(baseURL ?? "");

  try {
    await page.goto(proxy.url);
    await expectControlled(page);
    expect(await whichVersion(page)).toBe("no answer");

    // A new deploy: the same worker plus a reply that names the build.
    const current = await (await request.get("/sw.js")).text();
    proxy.replaceWorkerScript(`${current}
self.addEventListener("message", (event) => {
  if (event.data === "WHICH_VERSION") event.source.postMessage("new");
});`);

    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });

    await expect(page.getByRole("status")).toContainText("A new version is ready.");
    expect(await whichVersion(page)).toBe("no answer");

    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("button", { name: "Update" }).click(),
    ]);

    await expect(page.getByRole("heading", { level: 1, name: "And then…" })).toBeVisible();
    await expect.poll(() => whichVersion(page)).toBe("new");
    await expect(page.getByRole("button", { name: "Update" })).toHaveCount(0);
  } finally {
    await proxy.close();
  }
});

async function expectShellFromWorker(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);

  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page).toHaveTitle("And then…");
  await expect(page.getByRole("heading", { level: 1, name: "And then…" })).toBeVisible();
}

async function expectControlled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

async function fetchStatus(page: Page, path: string): Promise<number | "network error"> {
  return page.evaluate(
    (url) =>
      fetch(url).then(
        (response) => response.status,
        () => "network error" as const,
      ),
    path,
  );
}

/** Asks the page's service worker which build it is: only the replacement answers. */
async function whichVersion(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        navigator.serviceWorker.addEventListener(
          "message",
          (event) => {
            resolve(String(event.data));
          },
          { once: true },
        );
        navigator.serviceWorker.controller?.postMessage("WHICH_VERSION");
        setTimeout(() => {
          resolve("no answer");
        }, 500);
      }),
  );
}
