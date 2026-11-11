import { expect, test } from "@playwright/test";

import { names } from "./writers.ts";

test("a writer starts a story and the Worker creates it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill(names.ana);
  await page.getByLabel("Opening passage").fill("The lighthouse went dark at noon.");

  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/stories") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start the story" }).click();

  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/\/[a-z0-9]{5}$/);
  await expect(page.getByLabel("Invite link")).toBeVisible();
});
