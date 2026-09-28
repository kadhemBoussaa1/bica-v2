"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
// Imported for its side effect too: it starts listening for Chrome's
// install prompt as soon as this module loads.
import "./install-store";

/**
 * Registers the service worker (public/sw.js) — docs/pwa-plan.md step 6.
 * Mounted once in the root layout, so it also runs on /login and the
 * offline page is cached before anyone signs in. Renders nothing.
 *
 * Does nothing where the browser has no service workers, which includes
 * every insecure context: the LAN `DEV_ORIGIN` over http, and a production
 * `DOMAIN` that is a bare IP. Registers in development too — the worker is
 * network first and caches only /offline, so it cannot serve a stale build.
 */
export function PwaRegistrar() {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;

    // A tapped notification, with this window open: navigate in place
    // rather than reload (sw.js, notificationclick). Paths only.
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const { type, url } = data as { type?: unknown; url?: unknown };
      if (type !== "navigate" || typeof url !== "string") return;
      if (!url.startsWith("/") || url.startsWith("//")) return;
      router.push(url);
    };
    container.addEventListener("message", onMessage);
    // `addEventListener` alone leaves the queue closed until the document
    // has loaded; a message sent during a slow start would wait.
    container.startMessages();

    container
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.warn("[pwa] service worker registration failed", error));

    return () => container.removeEventListener("message", onMessage);
  }, [router]);

  // The cached offline page follows the language: on load and on a switch.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let current = true;
    void navigator.serviceWorker.ready.then((registration) => {
      if (current) registration.active?.postMessage({ type: "offline-locale", locale });
    });
    return () => {
      current = false;
    };
  }, [locale]);

  return null;
}
