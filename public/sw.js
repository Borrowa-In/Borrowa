/* Borrowa service worker
 *
 * Its only job is phone notifications: it wakes up when the server sends a push,
 * shows it, and opens the right page when it is tapped. It deliberately caches
 * nothing, so a new deploy is never served stale.
 *
 * Paths are resolved against the worker's own scope, so this works both at the
 * site root (borrowa.in) and under a sub-path (user.github.io/repo/).
 */
const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// FCM delivers { data: {...}, from, fcmMessageId } for data messages. Be tolerant
// of a plain { notification: {...} } or raw text payload as well.
function readPayload(event) {
  let raw = {};
  try {
    raw = event.data ? event.data.json() : {};
  } catch (e) {
    try { raw = { data: { body: event.data.text() } }; } catch (e2) { raw = {}; }
  }
  return Object.assign({}, raw.notification || {}, raw.data || {});
}

// Only ever open pages on our own site, whatever the payload says.
function safeTarget(url) {
  try {
    const u = new URL(url || "home.html", self.registration.scope);
    if (u.origin === new URL(self.registration.scope).origin) return u.href;
  } catch (e) { /* fall through */ }
  return scopeUrl("home.html");
}

self.addEventListener("push", (event) => {
  const d = readPayload(event);
  const options = {
    body: d.body || "Open Borrowa to see what's new.",
    icon: scopeUrl("icons/icon-192.png"),
    badge: scopeUrl("icons/badge-96.png"),
    data: { url: safeTarget(d.url) },
  };
  // A tag makes a newer notification replace an older one for the same thing.
  // (renotify without a tag throws, so only set it together.)
  if (d.tag) { options.tag = d.tag; options.renotify = true; }

  event.waitUntil(Promise.all([
    self.registration.showNotification(d.title || "Borrowa", options),
    // Let any open Borrowa tab refresh its bell right away.
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      tabs.forEach((c) => c.postMessage({ type: "borrowa-push", kind: d.kind || "" }));
    }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data && event.notification.data.url);

  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = tabs.find((c) => c.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus().catch(() => {});
      if ("navigate" in open) {
        try { await open.navigate(target); return; } catch (e) { /* fall back below */ }
      }
    }
    await self.clients.openWindow(target);
  })());
});
