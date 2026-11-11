import { expect, test, type Page } from "@playwright/test";

import { addPassage, joinStory, names, newWriter, startStory, storyText } from "./writers.ts";

const DESKTOP = { width: 1280, height: 800 };
const HIDDEN_PASSAGE = /^Passage by .*, hidden because you blocked them$/;
const HIDDEN_OPENING = "Opening passage, hidden because you blocked its author";

function authorButton(page: Page, name: string) {
  return storyText(page).getByRole("button", { name, exact: true });
}

async function chooseFromAuthorMenu(page: Page, author: string, item: string): Promise<void> {
  // Pressed near its left edge: a 40-character name runs past the right edge of a 375px screen,
  // so the centre of the button is off screen.
  await authorButton(page, author).click({ position: { x: 8, y: 8 } });
  await page.getByRole("menuitem", { name: item }).click();
  // Opening the menu again while it is still closing shuts it instead.
  await expect(page.getByRole("menuitem", { name: item })).toHaveCount(0);
}

// The real text must be gone from the page itself, not only hidden by CSS, so this reads the HTML.
async function expectNoTextInPage(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.content()).not.toContain(text);
}

test("a writer blocks another across all their stories, can reveal, unblock and re-block, and the blocked writer notices nothing", async ({
  browser,
}) => {
  const ana = await newWriter(browser, DESKTOP);
  const ben = await newWriter(browser, DESKTOP);
  const firstOpening = "A boat drifted in with no one aboard.";
  const secondOpening = "The clock struck thirteen.";
  const anasPassage = "Its lantern was still warm.";
  const bensSecondTurn = "Someone had left the kettle on.";
  const firstLink = await startStory(ben, names.ben, firstOpening);
  const secondLink = await startStory(ben, names.ben, secondOpening);
  await joinStory(ana, firstLink, names.ana);
  await joinStory(ana, secondLink, names.ana);
  await ana.goto(firstLink);
  await addPassage(ana, anasPassage);
  await ben.goto(firstLink);
  await addPassage(ben, bensSecondTurn);
  await expect(storyText(ana)).toContainText(bensSecondTurn);

  await chooseFromAuthorMenu(ana, names.ben, `Block ${names.ben}`);

  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(2);
  await expect(storyText(ana)).toContainText(anasPassage);
  await expectNoTextInPage(ana, firstOpening);
  await expectNoTextInPage(ana, bensSecondTurn);

  // One press shows one passage; the other stays hidden and the block stays.
  await ana.getByRole("button", { name: HIDDEN_PASSAGE }).first().click();
  await expect(storyText(ana)).toContainText(firstOpening);
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(1);
  await expectNoTextInPage(ana, bensSecondTurn);
  await authorButton(ana, names.ben).click();
  await expect(ana.getByRole("menuitem", { name: `Unblock ${names.ben}` })).toBeVisible();
  await ana.keyboard.press("Escape");

  // The block is one list per user, so it covers a story it was not made in. The list is read
  // from the server on each load, and the Your stories list is a different page and route.
  await ana.getByRole("link", { name: "← Your stories" }).click();
  const yourStories = ana.getByRole("region", { name: "Your stories" });
  await expect(yourStories.getByRole("img", { name: HIDDEN_OPENING })).toHaveCount(2);
  await expectNoTextInPage(ana, secondOpening);
  await ana.goto(secondLink);
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(1);
  await expectNoTextInPage(ana, secondOpening);

  // A user who left sees the opening on the Rejoin page, which obscures it too.
  await ana.getByRole("button", { name: "Leave story" }).click();
  const dialog = ana.getByRole("alertdialog", { name: "Leave this story?" });
  await dialog.getByRole("button", { name: "Leave story" }).click();
  await expect(ana.getByText("You left the story.")).toBeVisible();
  await ana.goto(secondLink);
  await expect(ana.getByRole("heading", { name: "You left this story" })).toBeVisible();
  await expect(ana.getByRole("img", { name: HIDDEN_OPENING })).toBeVisible();
  await expectNoTextInPage(ana, secondOpening);

  await ana.goto(firstLink);
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(2);
  await chooseFromAuthorMenu(ana, names.ben, `Unblock ${names.ben}`);
  await expect(storyText(ana)).toContainText(firstOpening);
  await expect(storyText(ana)).toContainText(bensSecondTurn);
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(0);

  // Blocking again hides a passage that was revealed before.
  await chooseFromAuthorMenu(ana, names.ben, `Block ${names.ben}`);
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(2);
  await expectNoTextInPage(ana, firstOpening);

  // Ben was never told, and sees Ana's passage as before.
  await ben.reload();
  await expect(storyText(ben)).toContainText(anasPassage);
  await expect(storyText(ben)).toContainText(firstOpening);
  await expect(ben.getByRole("button", { name: /hidden because you blocked/ })).toHaveCount(0);
});
