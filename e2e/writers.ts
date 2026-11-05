import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";

interface Viewport {
  width: number;
  height: number;
}

/** A phone-sized screen, below the width where the story page gains its authors margin. */
export const PHONE: Viewport = { width: 375, height: 800 };

/**
 * A writer is a page in its own browser context, so it has its own cookie jar: one context is one
 * participant. Each test starts its own story, so tests never share state.
 */
export async function newWriter(browser: Browser, viewport?: Viewport): Promise<Page> {
  const context = await browser.newContext(viewport === undefined ? {} : { viewport });

  return context.newPage();
}

/** Starts a story and returns its invite link. */
export async function startStory(page: Page, name: string, opening: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Opening passage").fill(opening);
  await page.getByRole("button", { name: "Start the story" }).click();

  await expect(page).toHaveURL(/\/[a-z0-9]{5}$/);
  await expect(page.getByLabel("Invite link")).toBeVisible();

  return page.getByLabel("Invite link").inputValue();
}

export async function joinStory(page: Page, inviteLink: string, name: string): Promise<void> {
  await page.goto(inviteLink);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();

  // Only a participant's page has the invite link.
  await expect(page.getByLabel("Invite link")).toBeVisible();
}
