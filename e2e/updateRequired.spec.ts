import { expect, test } from "@playwright/test";

test("every request to the API says which API level the app speaks", async ({ page }) => {
  const listRequest = page.waitForRequest((request) => request.url().endsWith("/api/stories"));

  await page.goto("/");

  expect((await listRequest).headers()["x-api-level"]).toBe("1");
});

test("a Worker that refuses the app's API level replaces the page with an update screen", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 426, json: { error: "client_outdated" } }),
  );

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 2, name: "Update to continue" })).toBeVisible();
  await expect(page.getByText("This version of And then… is out of date.")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByLabel("Opening passage")).toHaveCount(0);

  await page.evaluate(() => caches.open("stale"));

  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Update now" }).click(),
  ]);

  await expect(page.getByRole("heading", { level: 2, name: "Update to continue" })).toBeVisible();
  // With no service worker to hand over to, "Update now" also clears what the page cached.
  expect(await page.evaluate(() => caches.keys())).toStrictEqual([]);
});
