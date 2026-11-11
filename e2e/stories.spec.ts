import { expect, test } from "@playwright/test";

import {
  expectPageNotReloaded,
  joinStory,
  names,
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
  const firstLink = await startStory(ana, names.ana, "The lighthouse went dark at noon.");
  const secondLink = await startStory(ana, names.ana, "Rain fell on the empty market.");

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
  const inviteLink = await startStory(ana, names.ana, "The train stopped between stations.");
  await joinStory(ben, inviteLink, names.ben);
  await joinStory(cy, inviteLink, names.cy);
  await expect(turnBanner(ben)).toContainText("It's your turn");
  await tagPage(cy);

  await ben.getByRole("button", { name: "Leave story" }).click();
  const dialog = ben.getByRole("alertdialog", { name: "Leave this story?" });
  await expect(dialog).toContainText(`it passes to ${names.cy}`);
  await dialog.getByRole("button", { name: "Leave story" }).click();

  await expect(ben).toHaveURL("/");
  await expect(ben.getByText("You left the story.")).toBeVisible();
  await expect(ben.getByRole("region", { name: "Your stories" })).toHaveCount(0);
  await expect(turnBanner(cy)).toContainText("It's your turn");
  await expect(turnBanner(ana)).toContainText(`It's ${names.cy}'s turn`);
  await expect(turnBanner(cy)).not.toContainText(names.ben);
  await expectPageNotReloaded(cy);

  await ben.goto(inviteLink);
  await expect(ben.getByRole("heading", { name: "You left this story" })).toBeVisible();
  await ben.getByRole("button", { name: `Rejoin as ${names.ben}` }).click();

  await expect(turnBanner(ben)).toContainText(`${names.ben} (you)`);
  await expect(turnBanner(cy)).toContainText(names.ben);
});
