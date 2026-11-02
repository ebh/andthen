import type { Browser, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * A writer is a page in its own browser context, so it has its own cookie jar: one context is one
 * participant. Each test starts its own story, so tests never share state.
 */
export async function newWriter(browser: Browser): Promise<Page> {
  const context = await browser.newContext();

  return context.newPage();
}

/** Starts a story and returns its invite link. */
export async function startStory(page: Page, name: string, opening: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Opening passage").fill(opening);
  await page.getByRole("button", { name: "Start the story" }).click();

  await expect(page).toHaveURL(/\/[a-z0-9]{5}$/);
  await expect(storyText(page)).toContainText(opening);

  return page.getByLabel("Invite link").inputValue();
}

export async function joinStory(page: Page, inviteLink: string, name: string): Promise<void> {
  await page.goto(inviteLink);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();

  await expect(turnBanner(page)).toContainText(name);
}

export async function addPassage(page: Page, text: string): Promise<void> {
  await page.getByLabel("Your passage").fill(text);
  await page.getByRole("button", { name: "Add to the story" }).click();

  await expect(storyText(page)).toContainText(text);
}

export function turnBanner(page: Page): Locator {
  return page.getByRole("region", { name: "Turn" });
}

export function storyText(page: Page): Locator {
  return page.getByRole("region", { name: "The story so far" });
}

/**
 * Tags the running page. A reload or navigation wipes the tag, so a test that still finds it knows
 * the page changed on its own, which is what a live update is.
 */
export async function tagPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.assign(window, { notReloaded: true });
  });
}

export async function expectPageNotReloaded(page: Page): Promise<void> {
  expect(await page.evaluate(() => "notReloaded" in window)).toBe(true);
}
