import { expect, test } from "@playwright/test";

import { newWriter, startStory, storyText } from "./writers.ts";

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
