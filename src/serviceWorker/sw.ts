import { Serwist, type PrecacheEntry } from "serwist";

import { openNotifiedStory, showPushedNotification } from "../client/pushHandlers";

// Replaced with the list of files to precache when `scripts/buildServiceWorker.ts` bundles this file.
declare const PRECACHE_ENTRIES: (PrecacheEntry | string)[];

// A new build installs and then waits: there is no `skipWaiting`, so it takes over only when a page
// sends it `{type: "SKIP_WAITING"}` (Serwist listens for that message itself). Nothing is cached at run
// time, so the Worker's own answers (`/api/*`, any non-GET) always reach the network.
const serwist = new Serwist({
  precacheEntries: PRECACHE_ENTRIES,
  clientsClaim: true,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // The app is a single-page export, so any page address is served by the cached shell, except the API.
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api(\/|$)/],
  },
});

serwist.addEventListeners();

// Browsers with declarative Web Push (Safari) show the notification themselves; the rest hand the
// same payload to this handler.
if (self instanceof ServiceWorkerGlobalScope) {
  const scope: ServiceWorkerGlobalScope = self;

  scope.addEventListener("push", (event) => {
    event.waitUntil(showPushedNotification(event.data?.text(), scope.registration));
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
      (async () => {
        const tabs = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
        await openNotifiedStory(event.notification.data, scope.location.origin, tabs, (url) =>
          scope.clients.openWindow(url),
        );
      })(),
    );
  });
}
