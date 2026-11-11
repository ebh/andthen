import { expect, test, type Page } from "@playwright/test";

import { joinStory, names, newWriter, startStory, storyText } from "./writers.ts";

const DESKTOP = { width: 1280, height: 800 };
const HIDDEN_PASSAGE = /^Passage by .*, hidden because you blocked them$/;

test("a writer blocks another, sees their passages hidden in every story after a reload, and unblocks them", async ({
  browser,
}) => {
  const ana = await newWriter(browser, DESKTOP);
  const ben = await newWriter(browser, DESKTOP);
  const firstOpening = "A boat drifted in with no one aboard.";
  const secondOpening = "The clock struck thirteen.";
  const firstLink = await startStory(ben, names.ben, firstOpening);
  const secondLink = await startStory(ben, names.ben, secondOpening);
  await joinStory(ana, firstLink, names.ana);
  await joinStory(ana, secondLink, names.ana);
  await ana.goto(firstLink);
  await expect(storyText(ana)).toContainText(firstOpening);

  await chooseFromAuthorMenu(ana, `Block ${names.ben}`);

  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(1);
  await expectNoTextInPage(ana, firstOpening);

  // A real load reads the block list from the server, and it covers a story it was not made in.
  await ana.reload();
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(1);
  await expectNoTextInPage(ana, firstOpening);
  await ana.goto(secondLink);
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(1);
  await expectNoTextInPage(ana, secondOpening);

  await chooseFromAuthorMenu(ana, `Unblock ${names.ben}`);
  await expect(storyText(ana)).toContainText(secondOpening);
  await expect(ana.getByRole("button", { name: HIDDEN_PASSAGE })).toHaveCount(0);
});

async function chooseFromAuthorMenu(page: Page, item: string): Promise<void> {
  await storyText(page).getByRole("button", { name: names.ben, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
  // Opening the menu again while it is still closing shuts it instead.
  await expect(page.getByRole("menuitem", { name: item })).toHaveCount(0);
}

// The real text must be gone from the page itself, not only hidden by CSS, so this reads the HTML.
async function expectNoTextInPage(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.content()).not.toContain(text);
}
