import { expect, test } from "@playwright/test";

test("a writer starts a story and the Worker creates it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill("Ana");
  await page.getByLabel("Opening passage").fill("The lighthouse went dark at noon.");

  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/stories") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start the story" }).click();

  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(/\/[a-z0-9]{5}$/);
});

test("an address with no page shows the not-found page, which leads back to the start", async ({
  page,
}) => {
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();

  await page.getByText("Start a new story").click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Start a story" })).toBeVisible();
});
