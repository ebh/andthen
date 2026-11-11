import { expect, test } from "@playwright/test";

import {
  PHONE,
  addPassage,
  expectPageNotReloaded,
  joinStory,
  names,
  newWriter,
  startStory,
  storyText,
  tagPage,
  turnBanner,
} from "./writers.ts";

test("two writers take turns and each sees the other's passage live", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, names.ana, "The lighthouse went dark at noon.");
  await expect(turnBanner(ana)).toContainText("Waiting for someone to join");
  await tagPage(ana);

  await joinStory(ben, inviteLink, names.ben);
  await tagPage(ben);

  // Ana's open page learns of the join over the live socket; she never reloads.
  await expect(turnBanner(ana)).toContainText(`It's ${names.ben}'s turn`);
  await expect(turnBanner(ben)).toContainText("It's your turn");

  await addPassage(ben, "A boat drifted in with no one aboard.");
  await expect(storyText(ana)).toContainText("A boat drifted in with no one aboard.");
  await expect(turnBanner(ana)).toContainText("It's your turn");
  await expect(turnBanner(ben)).toContainText(`It's ${names.ana}'s turn`);

  await addPassage(ana, "Its lantern was still warm.");
  await expect(storyText(ben)).toContainText("Its lantern was still warm.");
  await expect(turnBanner(ben)).toContainText("It's your turn");

  await expectPageNotReloaded(ana);
  await expectPageNotReloaded(ben);
});

test("a reload keeps the story and the writer's place in it", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, names.ana, "Rain fell on the empty market.");
  await joinStory(ben, inviteLink, names.ben);
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

  const inviteLink = await startStory(ana, names.ana, "The train stopped between stations.");
  await joinStory(ben, inviteLink, names.ben);
  await joinStory(cy, inviteLink, names.cy);
  await expect(turnBanner(cy)).toContainText(`It's ${names.ben}'s turn`);

  // The writer holding the turn gets no skip button. Wait until Ben's page shows it is his turn,
  // so the button is absent because of the rule and not because the page hasn't loaded.
  await expect(turnBanner(ben)).toContainText("It's your turn");
  await expect(ben.getByRole("button", { name: /^Skip/ })).toHaveCount(0);

  await cy.getByRole("button", { name: `Skip ${names.ben}` }).click();

  await expect(turnBanner(cy)).toContainText("It's your turn");
  await expect(turnBanner(ben)).toContainText(`It's ${names.cy}'s turn`);
  await expect(turnBanner(ana)).toContainText(`It's ${names.cy}'s turn`);
});

test("authors sit in a margin on wide screens and behind a toggle on phones", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser, PHONE);

  const inviteLink = await startStory(ana, names.ana, "The bridge hummed at dusk.");
  await joinStory(ben, inviteLink, names.ben);

  await expect(storyText(ana).getByText(names.ana, { exact: true })).toBeVisible();

  const authorOnPhone = storyText(ben).getByText(names.ana, { exact: true });
  await expect(storyText(ben)).toContainText("The bridge hummed at dusk.");
  await expect(authorOnPhone).toBeHidden();

  await ben.getByLabel("Show authors").check();
  await expect(authorOnPhone).toBeVisible();

  await ben.getByLabel("Show authors").uncheck();
  await expect(authorOnPhone).toBeHidden();
});

test("turns share a paragraph until a writer starts a new one, and authors highlight their turns", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser, PHONE);
  const inviteLink = await startStory(ana, names.ana, "The bridge hummed at dusk.");
  await joinStory(ben, inviteLink, names.ben);

  await addPassage(ben, "The lamps came on.");
  await addPassage(ana, "Morning came at last.", { newParagraph: true });

  const paragraphs = storyText(ana).getByRole("paragraph");
  await expect(paragraphs).toHaveText([
    "The bridge hummed at dusk. The lamps came on.",
    "Morning came at last.",
  ]);

  await storyText(ana).getByRole("button", { name: names.ben }).hover();
  await expect(storyText(ana).locator("mark")).toHaveText("The lamps came on.");
  await ana.mouse.move(0, 0);
  await expect(storyText(ana).locator("mark")).toHaveCount(0);

  await expect(storyText(ben)).toContainText("Morning came at last.");
  await ben.getByLabel("Show authors").check();
  await storyText(ben).getByRole("button", { name: names.ana }).first().click();
  await ben.getByRole("menuitemcheckbox", { name: "Highlight passages" }).click();
  await expect(storyText(ben).locator("mark")).toHaveText("The bridge hummed at dusk.");
});

test("a suggestion fills the composer but sends nothing", async ({ browser }) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, names.ana, "The door had no handle.");
  await joinStory(ben, inviteLink, names.ben);
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

test("a second writer opens the invite link, joins by name and sees the story page", async ({
  browser,
}) => {
  const ana = await newWriter(browser);
  const ben = await newWriter(browser);

  const inviteLink = await startStory(ana, names.ana, "The lighthouse went dark at noon.");
  expect(inviteLink).toBe(ana.url());

  await ben.goto(inviteLink);
  await expect(ben.getByRole("heading", { name: "Join this story" })).toBeVisible();
  await expect(ben.getByLabel("Invite link")).toHaveCount(0);

  await joinStory(ben, inviteLink, names.ben);

  await expect(ben.getByLabel("Invite link")).toHaveValue(inviteLink);
  await expect(ben.getByRole("heading", { name: "Join this story" })).toHaveCount(0);
});

test("a page taller than a short screen scrolls to its last control", async ({ browser }) => {
  // Short enough that the invite link falls below the fold before anyone has joined.
  const screenHeight = 400;
  const ana = await newWriter(browser, { width: 375, height: screenHeight });
  await startStory(ana, names.ana, "The lighthouse went dark at noon.");
  const copyLink = ana.getByRole("button", { name: "Copy link" });
  const bottomOfCopyLink = async (): Promise<number> => {
    const box = await copyLink.boundingBox();
    return box === null ? Number.NaN : box.y + box.height;
  };

  // The phone layout stacks the rail, the story and the invite link, so the button starts below the fold.
  expect(await bottomOfCopyLink()).toBeGreaterThan(screenHeight);

  // A real wheel scroll, not scrollIntoView: scrollIntoView also works on a page clipped by overflow: hidden.
  await ana.mouse.move(100, 300);
  await ana.mouse.wheel(0, 1000);

  await expect.poll(bottomOfCopyLink).toBeLessThanOrEqual(screenHeight);
  await copyLink.click();
});
