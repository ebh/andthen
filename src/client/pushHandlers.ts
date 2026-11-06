import { z } from "zod";

import { turnPushPayloadSchema } from "../shared/api";

/** The part of a `ServiceWorkerRegistration` that `showPushedNotification` uses. */
export interface NotificationDisplay {
  showNotification(
    title: string,
    options: { body: string; tag: string; data: { navigate: string } },
  ): Promise<void>;
}

/** An open tab, as `clients.matchAll` lists it. */
export interface OpenTab {
  url: string;
  focus(): Promise<unknown>;
}

const notificationDataSchema = z.object({ navigate: z.url() });

/**
 * Shows the notification that a push message describes. A message that is not the "your turn"
 * payload shows nothing, so a stray or newer-shaped message never raises a blank notification.
 * The tag replaces an earlier notification for the same story, so a browser that also shows the
 * declarative payload itself ends up with one.
 */
export async function showPushedNotification(
  text: string | undefined,
  display: NotificationDisplay,
): Promise<void> {
  const payload = parsePayload(text);
  if (payload === undefined) {
    return;
  }

  const { title, body, tag, navigate } = payload.notification;
  await display.showNotification(title, { body, tag, data: { navigate } });
}

/**
 * Brings the story's tab to the front, or opens it. Does nothing when the notification carries no
 * address or one on another site, so a tap can only ever open this app.
 */
export async function openNotifiedStory(
  notificationData: unknown,
  appOrigin: string,
  tabs: readonly OpenTab[],
  openTab: (url: string) => Promise<unknown>,
): Promise<void> {
  const data = notificationDataSchema.safeParse(notificationData);
  if (!data.success || new URL(data.data.navigate).origin !== appOrigin) {
    return;
  }

  const { navigate } = data.data;
  const open = tabs.find((tab) => tab.url === navigate);
  await (open === undefined ? openTab(navigate) : open.focus());
}

function parsePayload(text: string | undefined) {
  if (text === undefined) {
    return undefined;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  const payload = turnPushPayloadSchema.safeParse(json);

  return payload.success ? payload.data : undefined;
}
