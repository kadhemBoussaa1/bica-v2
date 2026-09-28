import { z } from "zod";
import type { NotificationPayload } from "./notifications.js";

/**
 * Web Push — docs/pwa-plan.md, phase 2.
 *
 * A browser that turns phone notifications on hands the API a subscription:
 * a URL on its vendor's push service and two keys. The API later POSTs an
 * encrypted `PushMessage` to that URL for each personal notification.
 */

/**
 * The push services a subscription may point at. The API sends requests to
 * the endpoint itself, so without this list any signed-in user could aim the
 * server at any host. Chrome and Edge's Chromium, Firefox, Safari (macOS and
 * the iOS Home Screen app), legacy Edge, and Samsung Internet.
 */
export function isPushServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "fcm.googleapis.com" ||
    host === "web.push.apple.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".push.services.mozilla.com") ||
    host.endsWith(".notify.windows.com") ||
    host.endsWith(".push.samsungosp.com")
  );
}

/** `PushSubscription.toJSON()` writes its keys as unpadded base64url. */
const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, "Expected base64url");

export const pushSubscriptionInput = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    // Zod may run this after a failed `.url()`, so the parse is guarded.
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && isPushServiceHost(url.hostname);
      } catch {
        return false;
      }
    }, "Not a known push service"),
  keys: z.object({
    // A P-256 public point is 65 bytes (87 characters); the secret, 16 (22).
    p256dh: base64url(128),
    auth: base64url(64),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInput>;

/** Scoped to the caller's own rows by the service; no allowlist needed. */
export const pushUnsubscribeInput = z.object({
  endpoint: z.string().min(1).max(2048),
});
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeInput>;

/**
 * What one push carries, encrypted, to the service worker (public/sw.js).
 * The row's own kind and params — the worker has them worded by the web app
 * in the device's language — its id (the notification's tag) and the page a
 * tap opens (`notificationHref`). A signal, like the SSE event: the row in
 * the database stays the truth.
 */
export type PushMessage = NotificationPayload & { id: string; url: string };
