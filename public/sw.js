/* Folio Service Worker — Web Push & Notification Deep Links */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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

  const actions = [
    { action: "open", title: "Open" },
  ];

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
