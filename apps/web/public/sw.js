/*
 * The Bicapack service worker — docs/pwa-plan.md steps 4 and 15.
 *
 * Hand-written, no library, and deliberately small. It does two things:
 *
 * 1. Offline: a navigation that fails for want of a network gets the one
 *    cached page, /offline. NOTHING ELSE IS CACHED — no page, no tRPC call,
 *    no business data — so a device shared between users cannot hand one
 *    user's screen to the next. Scripts and styles are left to the HTTP
 *    cache (Next serves /_next/static as immutable); a second copy here
 *    would need eviction and could mix two deployments.
 *
 * 2. Push: the API sends `{ id, kind, params, url }` for the personal
 *    notification kinds. The words come from /push/describe, a web route
 *    that runs the bell's own wording in this browser's language (its
 *    `bp-locale` cookie), so a push, a toast and the bell never disagree.
 *
 * Bump VERSION whenever this file changes: it names the cache, and the
 * activate step deletes every other `bp-` cache.
 */

const VERSION = "2026-09-28.1";
const OFFLINE_CACHE = `bp-offline-${VERSION}`;
const OFFLINE_URL = "/offline";
const FALLBACK_TITLE = "Bicapack";
const DESCRIBE_TIMEOUT_MS = 4000;

// ---- lifecycle ---------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("bp-") && name !== OFFLINE_CACHE)
          .map((name) => caches.delete(name)),
      );
      // The page request starts while the worker boots rather than after.
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

// ---- offline -----------------------------------------------------------------

/**
 * Network first, always: only a navigation that throws (no network, DNS,
 * refused) falls back. An HTTP error, a redirect to /login or a 500 is the
 * server's answer and passes through untouched. Every other request —
 * scripts, RSC payloads, tRPC — never reaches this handler's body.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        const offline = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
        return offline ?? Response.error();
      }
    })(),
  );
});

/**
 * The page tells the worker its language (app/pwa/pwa-registrar.tsx) on
 * load and on every change. The cached /offline says which language it is
 * in through Content-Language; a mismatch refetches it, and the fetch
 * carries the `bp-locale` cookie, so it comes back in the new one.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "offline-locale" && typeof data.locale === "string") {
    event.waitUntil(refreshOffline(data.locale));
  }
});

async function refreshOffline(locale) {
  const cache = await caches.open(OFFLINE_CACHE);
  const cached = await cache.match(OFFLINE_URL);
  if (cached?.headers.get("Content-Language") === locale) return;
  try {
    await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
  } catch {
    // Offline right now: the old language stays until the next message.
  }
}

// ---- push --------------------------------------------------------------------

self.addEventListener("push", (event) => {
  event.waitUntil(onPush(event));
});

/** The payload, or null when it is missing or not JSON. */
function readMessage(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

async function onPush(event) {
  const message = readMessage(event);

  // Someone is looking at the app: the stream's toast already says it. A
  // focused window, not just a visible one — Chrome's exemption from its
  // "updated in the background" notice is keyed on focus.
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const watching = windows.some((client) => client.visibilityState === "visible" && client.focused);
  if (watching && message && !(await mustAlwaysShow())) return;

  const text = message ? await describe(message) : { title: FALLBACK_TITLE };
  await self.registration.showNotification(text.title, {
    body: text.body,
    lang: text.lang,
    dir: text.dir ?? "auto",
    // One notification per row: a retried push replaces rather than stacks.
    tag: message?.id,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: { url: message?.url ?? "/" },
  });
}

/**
 * WebKit revokes a subscription whose pushes show nothing, focused window or
 * not, so on Apple's push service every push is shown. Read off the
 * subscription itself rather than the user agent: it is exactly the case.
 */
async function mustAlwaysShow() {
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription) return false;
  return new URL(subscription.endpoint).hostname.endsWith("push.apple.com");
}

/**
 * The bell's words for this row, in this browser's language. The route is
 * a pure formatter (it reads no data), so it answers even when the session
 * cookie has lapsed. A failure or a slow answer still shows the push, under
 * the app's name: a late notification is worse than a plain one.
 */
async function describe(message) {
  try {
    const response = await fetch("/push/describe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: message.kind, params: message.params }),
      signal: AbortSignal.timeout(DESCRIBE_TIMEOUT_MS),
    });
    if (response.ok) {
      const text = await response.json();
      if (typeof text?.title === "string") return text;
    }
  } catch {
    // Offline, timed out, or an old worker meeting a newer route.
  }
  return { title: FALLBACK_TITLE };
}

/**
 * A tap opens the row's page. An open window is focused and asked to
 * navigate itself (the registrar calls router.push), which keeps it a
 * client-side navigation; `client.navigate()` would force a full reload
 * and fails outright on a window this worker does not control. With no
 * window, a new one opens on the page.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openApp(sameOriginPath(event.notification.data?.url)));
});

/** Only a path on this origin, whatever the payload says. */
function sameOriginPath(raw) {
  try {
    const url = new URL(typeof raw === "string" ? raw : "/", self.location.origin);
    if (url.origin === self.location.origin) return url.pathname + url.search + url.hash;
  } catch {
    // Fall through to the home page.
  }
  return "/";
}

async function openApp(path) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = windows.find((candidate) => candidate.focused) ?? windows[0];
  if (client) {
    try {
      await client.focus();
    } catch {
      // Focus may be refused; the message below still navigates it.
    }
    client.postMessage({ type: "navigate", url: path });
    return;
  }
  await self.clients.openWindow(path);
}
