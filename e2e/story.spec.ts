import { expect, test } from "@playwright/test";

import {
  PHONE,
  addPassage,
  expectPageNotReloaded,
  joinStory,
  newWriter,
  startStory,
  storyText,
  tagPage,
  turnBanner,
} from "./writers.ts";

test("two writers take turns and each sees the other's passage live", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, "Ana", "The lighthouse went dark at noon.");
  await expect(turnBanner(ana)).toContainText("Waiting for someone to join");
  await tagPage(ana);

  await joinStory(ben, inviteLink, "Ben");
  await tagPage(ben);

  // Ana's open page learns of the join over the live socket; she never reloads.
  await expect(turnBanner(ana)).toContainText("It's Ben's turn");
  await expect(turnBanner(ben)).toContainText("It's your turn");

  await addPassage(ben, "A boat drifted in with no one aboard.");
  await expect(storyText(ana)).toContainText("A boat drifted in with no one aboard.");
  await expect(turnBanner(ana)).toContainText("It's your turn");
  await expect(turnBanner(ben)).toContainText("It's Ana's turn");

  await addPassage(ana, "Its lantern was still warm.");
  await expect(storyText(ben)).toContainText("Its lantern was still warm.");
  await expect(turnBanner(ben)).toContainText("It's your turn");

  await expectPageNotReloaded(ana);
  await expectPageNotReloaded(ben);
});

test("a reload keeps the story and the writer's place in it", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, "Ana", "Rain fell on the empty market.");
  await joinStory(ben, inviteLink, "Ben");
  await addPassage(ben, "A single stall was still lit.");
  await expect(turnBanner(ana)).toContainText("It's your turn");

  await ana.reload();

  await expect(storyText(ana)).toContainText("Rain fell on the empty market.");
  await expect(storyText(ana)).toContainText("A single stall was still lit.");
  await expect(turnBanner(ana)).toContainText("It's your turn");
});

test("with three writers, someone else can skip the writer whose turn it is", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);
  const cy = await newWriter(browser);

  const inviteLink = await startStory(ana, "Ana", "The train stopped between stations.");
  await joinStory(ben, inviteLink, "Ben");
  await joinStory(cy, inviteLink, "Cy");
  await expect(turnBanner(cy)).toContainText("It's Ben's turn");

  // The writer holding the turn gets no skip button. Wait until Ben's page shows it is his turn,
  // so the button is absent because of the rule and not because the page hasn't loaded.
  await expect(turnBanner(ben)).toContainText("It's your turn");
  await expect(ben.getByRole("button", { name: /^Skip/ })).toHaveCount(0);

  await cy.getByRole("button", { name: "Skip Ben" }).click();

  await expect(turnBanner(cy)).toContainText("It's your turn");
  await expect(turnBanner(ben)).toContainText("It's Cy's turn");
  await expect(turnBanner(ana)).toContainText("It's Cy's turn");
});

test("authors sit in a margin on wide screens and behind a toggle on phones", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser, PHONE);

  const inviteLink = await startStory(ana, "Ana", "The bridge hummed at dusk.");
  await joinStory(ben, inviteLink, "Ben");

  await expect(storyText(ana).getByText("Ana", { exact: true })).toBeVisible();

  const authorOnPhone = storyText(ben).getByText("Ana", { exact: true });
  await expect(storyText(ben)).toContainText("The bridge hummed at dusk.");
  await expect(authorOnPhone).toBeHidden();

  await ben.getByLabel("Show authors").check();
  await expect(authorOnPhone).toBeVisible();

  await ben.getByLabel("Show authors").uncheck();
  await expect(authorOnPhone).toBeHidden();
});

test("a suggestion fills the composer but sends nothing", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, "Ana", "The door had no handle.");
  await joinStory(ben, inviteLink, "Ben");
  await expect(turnBanner(ben)).toContainText("It's your turn");

  await ben.getByRole("button", { name: "Suggest continuations" }).click();
  const suggestion = ben
    .getByRole("region", { name: "Suggestions" })
    .getByRole("listitem")
    .first()
    .getByRole("button");
  const suggestionText = (await suggestion.textContent()) ?? "";
  expect(suggestionText).not.toBe("");

  await suggestion.click();

  await expect(ben.getByLabel("Your passage")).toHaveValue(suggestionText);
  // Both pages have loaded the story, so a missing suggestion means it was not sent.
  await expect(storyText(ben)).toContainText("The door had no handle.");
  await expect(storyText(ana)).toContainText("The door had no handle.");
  await expect(storyText(ben)).not.toContainText(suggestionText);
  await expect(storyText(ana)).not.toContainText(suggestionText);
  await expect(turnBanner(ben)).toContainText("It's your turn");
});
