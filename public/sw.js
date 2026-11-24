/* Folio Service Worker — Web Push, Notification Quick Actions & Public-Only Offline Fallback */

const PUBLIC_CACHE_NAME = "folio-public-v1";
const OFFLINE_URL = "/offline";
const PUBLIC_PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PUBLIC_CACHE_NAME)
      .then((cache) => cache.addAll(PUBLIC_PRECACHE_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PUBLIC_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Security-first navigation fetch handler:
 * - Always goes network-first for page navigations.
 * - Falls back to the static `/offline` page ONLY when the network fails.
 * - NEVER writes `/api/*`, `/app/*`, or `/invite/*` private responses into Cache Storage.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept or cache private API endpoints or invite tokens
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/invite/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(PUBLIC_CACHE_NAME);
        const cachedOffline = await cache.match(OFFLINE_URL);
        if (cachedOffline) return cachedOffline;
        return new Response("You are offline. Please reconnect to use Folio.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
    );
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {
    title: "Folio Reminder",
    body: "You have a scheduled reminder.",
    deepLink: "/app/inbox",
    reminderId: null,
    entityType: "task",
    entityId: null,
  };

  try {
    const parsed = event.data.json();
    payload = { ...payload, ...parsed };
  } catch {
    payload.body = event.data.text() || payload.body;
  }

  const actions = [{ action: "open", title: "Open" }];

  if (payload.reminderId) {
    actions.push({ action: "snooze_15m", title: "Snooze 15m" });
  }

  if (payload.entityType === "task" && payload.entityId) {
    actions.push({ action: "mark_done", title: "Mark Done" });
  }

  const options = {
    body: payload.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.reminderId
      ? `folio-reminder-${payload.reminderId}`
      : `folio-notif-${Date.now()}`,
    renotify: true,
    data: {
      deepLink: payload.deepLink || "/app/inbox",
      reminderId: payload.reminderId || null,
      entityType: payload.entityType || null,
      entityId: payload.entityId || null,
    },
    actions,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const deepLink =
    typeof data.deepLink === "string" && data.deepLink.startsWith("/")
      ? data.deepLink
      : "/app/inbox";

  if (event.action === "snooze_15m" && data.reminderId) {
    event.waitUntil(
      fetch("/api/reminders/quick-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "snooze_15m",
          reminderId: data.reminderId,
        }),
      }).catch(() => undefined)
    );
    return;
  }

  if (
    event.action === "mark_done" &&
    data.entityType === "task" &&
    data.entityId
  ) {
    event.waitUntil(
      fetch("/api/reminders/quick-action", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_done",
          taskId: data.entityId,
        }),
      }).catch(() => undefined)
    );
    return;
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const targetUrl = new URL(deepLink, self.location.origin).href;
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            return client.navigate(targetUrl).then((navigated) => {
              return navigated ? navigated.focus() : client.focus();
            });
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
