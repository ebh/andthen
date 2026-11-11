import { expect, test } from "@playwright/test";

// Pins that "Update now" clears the real browser Cache API (`deleteAllCaches` in
// src/client/appUpdate.ts), which only a real browser has. The screen text is covered by
// src/ui/UpdateGate.test.tsx. Without this test, that cache clearing is untested.
test("a Worker that refuses the app's API level replaces the page with an update screen", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 426, json: { error: "client_outdated" } }),
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 2, name: "Update to continue" })).toBeVisible();

  await page.evaluate(() => caches.open("stale"));

  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Update now" }).click(),
  ]);

  await expect(page.getByRole("heading", { level: 2, name: "Update to continue" })).toBeVisible();
  // With no service worker to hand over to, "Update now" also clears what the page cached.
  expect(await page.evaluate(() => caches.keys())).toStrictEqual([]);
});
