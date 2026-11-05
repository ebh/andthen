import { expect, test } from "@playwright/test";

import {
  PHONE,
  expectPageNotReloaded,
  joinStory,
  newWriter,
  startStory,
  storyText,
  tagPage,
  turnBanner,
} from "./writers.ts";

test("a writer finds and switches between their stories without remembering a link", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const firstLink = await startStory(ana, "Ana", "The lighthouse went dark at noon.");
  const secondLink = await startStory(ana, "Ana", "Rain fell on the empty market.");

  await ana.getByRole("link", { name: "← Your stories" }).click();
  const stories = ana.getByRole("region", { name: "Your stories" });
  await expect(stories.getByRole("link")).toHaveCount(2);

  await stories.getByRole("link", { name: /lighthouse/ }).click();
  await expect(ana).toHaveURL(firstLink);
  await expect(storyText(ana)).toContainText("The lighthouse went dark at noon.");

  await ana.getByRole("link", { name: "← Your stories" }).click();
  await stories.getByRole("link", { name: /empty market/ }).click();
  await expect(ana).toHaveURL(secondLink);
});

test("a writer who holds the turn can leave, the turn moves on live, and they can rejoin", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);
  const cy = await newWriter(browser);
  const inviteLink = await startStory(ana, "Ana", "The train stopped between stations.");
  await joinStory(ben, inviteLink, "Ben");
  await joinStory(cy, inviteLink, "Cy");
  await expect(turnBanner(ben)).toContainText("It's your turn");
  await tagPage(cy);

  await ben.getByRole("button", { name: "Leave story" }).click();
  const dialog = ben.getByRole("alertdialog", { name: "Leave this story?" });
  await expect(dialog).toContainText("it passes to Cy");
  await dialog.getByRole("button", { name: "Leave story" }).click();

  await expect(ben).toHaveURL("/");
  await expect(ben.getByText("You left the story.")).toBeVisible();
  await expect(ben.getByRole("region", { name: "Your stories" })).toHaveCount(0);
  await expect(turnBanner(cy)).toContainText("It's your turn");
  await expect(turnBanner(ana)).toContainText("It's Cy's turn");
  await expect(turnBanner(cy)).not.toContainText("Ben");
  await expectPageNotReloaded(cy);

  await ben.goto(inviteLink);
  await expect(ben.getByRole("heading", { name: "You left this story" })).toBeVisible();
  await ben.getByRole("button", { name: "Rejoin as Ben" }).click();

  await expect(turnBanner(ben)).toContainText("Ben (you)");
  await expect(turnBanner(cy)).toContainText("Ben");
});

test("on a phone, a writer sees their stories, leaves one and comes back", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser, PHONE);
  const inviteLink = await startStory(ana, "Ana", "The bridge hummed at dusk.");
  await joinStory(ben, inviteLink, "Ben");
  await startStory(ben, "Ben", "A kettle whistled upstairs.");

  await ben.getByRole("link", { name: "← Your stories" }).click();
  const stories = ben.getByRole("region", { name: "Your stories" });
  await expect(stories.getByRole("link")).toHaveCount(2);
  await expect(stories.getByRole("link", { name: /bridge hummed/ })).toContainText("Your turn");

  await stories.getByRole("link", { name: /bridge hummed/ }).click();
  await ben.getByRole("button", { name: "Leave story" }).click();
  const dialog = ben.getByRole("alertdialog", { name: "Leave this story?" });
  await expect(dialog).toContainText("the story will wait");
  await dialog.getByRole("button", { name: "Leave story" }).click();

  await expect(ben.getByText("You left the story.")).toBeVisible();
  await expect(stories.getByRole("link")).toHaveCount(1);

  await ben.goto(inviteLink);
  await ben.getByRole("button", { name: "Rejoin as Ben" }).click();
  await expect(turnBanner(ben)).toContainText("It's your turn");
});
