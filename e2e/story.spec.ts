import { expect, test } from "@playwright/test";

import { joinStory, newWriter, startStory } from "./writers.ts";

test("a second writer opens the invite link, joins by name and sees the story page", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, "Ana", "The lighthouse went dark at noon.");
  expect(inviteLink).toBe(ana.url());

  await ben.goto(inviteLink);
  await expect(ben.getByRole("heading", { name: "Join this story" })).toBeVisible();
  await expect(ben.getByLabel("Invite link")).toHaveCount(0);

  await joinStory(ben, inviteLink, "Ben");

  await expect(ben.getByLabel("Invite link")).toHaveValue(inviteLink);
  await expect(ben.getByRole("heading", { name: "Join this story" })).toHaveCount(0);
});

test("a writer who has joined stays in the story after a reload", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);
  const inviteLink = await startStory(ana, "Ana", "Rain fell on the empty market.");
  await joinStory(ben, inviteLink, "Ben");

  await ben.reload();

  await expect(ben.getByLabel("Invite link")).toHaveValue(inviteLink);
  await expect(ben.getByRole("heading", { name: "Join this story" })).toHaveCount(0);
});

test("joining needs a name that nobody in the story already uses", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);
  const inviteLink = await startStory(ana, "Ana", "The train stopped between stations.");

  await ben.goto(inviteLink);
  await ben.getByRole("button", { name: "Join" }).click();
  await expect(ben.getByRole("alert")).toHaveText("Enter a name.");

  await ben.getByLabel("Your name").fill("Ana");
  await ben.getByRole("button", { name: "Join" }).click();
  await expect(ben.getByRole("alert")).toContainText("already uses that name");

  await ben.getByLabel("Your name").fill("Ben");
  await ben.getByRole("button", { name: "Join" }).click();
  await expect(ben.getByLabel("Invite link")).toBeVisible();
});

test("a story ID that doesn't exist says so and leads back to the start", async ({ page }) => {
  await page.goto("/zzzzz");
  await expect(page.getByText("That story doesn't exist.")).toBeVisible();

  await page.getByRole("link", { name: "Start a new story" }).click();

  await expect(page).toHaveURL("/");
});
