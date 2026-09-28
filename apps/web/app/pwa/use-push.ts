"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PushSubscriptionInput } from "@repo/api-contract";
import { useTRPC, useTRPCClient } from "../trpc/client";
import { useInstall } from "./use-install";

/**
 * This device's phone notifications — docs/pwa-plan.md step 16.
 *
 * The browser holds the subscription; the API holds a copy bound to the
 * session that made it (so signing out, anywhere, ends it). This file keeps
 * the two in step, and remembers WHICH account turned it on (`bp-push-owner`
 * in localStorage): on a shared phone, the next user must not inherit the
 * previous one's switch.
 */

const OWNER_KEY = "bp-push-owner";

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Private mode or blocked storage: the switch still works this session.
  }
}

/** Service worker, Push API and notifications, which iOS grants only to a Home Screen app. */
function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The VAPID key as bytes: WebKit rejects the base64url string form. */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Was this subscription made with the server's current key? A rotated key orphans it. */
function sameKey(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const expected = base64UrlToBytes(publicKey);
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

function toInput(subscription: PushSubscription): PushSubscriptionInput | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/**
 * Sign-out's half (use-auth.ts): drops this browser's subscription and the
 * icon badge. Best effort and never throws — the server's row goes with the
 * session anyway. `getRegistration`, not `ready`, which never settles on a
 * page no worker controls.
 */
export async function forgetThisDevice(): Promise<void> {
  try {
    if ("clearAppBadge" in navigator) await navigator.clearAppBadge();
    if (!pushSupported()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
    writeOwner(null);
  } catch {
    // Nothing to undo.
  }
}

/**
 * On every load, for the signed-in account: a subscription this account
 * made is sent again, which rebinds it to the CURRENT session — the old one
 * may have expired, or this is a fresh sign-in on the same phone. Anyone
 * else's subscription, or one made with a rotated key, is dropped: the
 * switch shows off and its owner turns it back on.
 */
export function usePushSync(userId: string): void {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const config = useQuery({ ...trpc.push.config.queryOptions(), staleTime: Infinity });
  const publicKey = config.data?.publicKey ?? null;

  useEffect(() => {
    if (!publicKey || !pushSupported()) return;
    let current = true;
    void (async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription || !current) return;
      if (readOwner() !== userId || !sameKey(subscription, publicKey)) {
        await subscription.unsubscribe();
        writeOwner(null);
        return;
      }
      const input = toInput(subscription);
      if (input) await client.push.subscribe.mutate(input);
    })().catch(() => {
      // The next load tries again.
    });
    return () => {
      current = false;
    };
  }, [client, publicKey, userId]);
}

export type PushState =
  | "hidden" // push is off on the server (or its config is loading)
  | "unsupported" // this browser cannot do it
  | "install-first" // iOS in a Safari tab: only the Home Screen app can
  | "denied" // blocked in the browser's settings
  | "off"
  | "on";

/**
 * The bell's switch (PushToggle). Mounted only once the panel opens, so
 * reading `window` in the initialisers is safe: it never renders on the
 * server.
 */
export function usePush(userId: string) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const { isIos, isStandalone } = useInstall();
  const config = useQuery({ ...trpc.push.config.queryOptions(), staleTime: Infinity });
  const publicKey = config.data?.publicKey ?? null;

  const [supported] = useState(pushSupported);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    supported ? Notification.permission : "default",
  );
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Loaded before any click: `enable` must await the permission prompt
  // first, or iOS drops the user gesture that allows it.
  useEffect(() => {
    if (!supported) return;
    let current = true;
    void navigator.serviceWorker.ready
      .then(async (ready) => {
        const subscription = await ready.pushManager.getSubscription();
        if (!current) return;
        setRegistration(ready);
        setSubscribed(subscription !== null && readOwner() === userId);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [supported, userId]);

  const enable = async () => {
    if (!registration || !publicKey) return;
    setBusy(true);
    setFailed(false);
    try {
      const answer = await Notification.requestPermission();
      setPermission(answer);
      if (answer !== "granted") return;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      });
      const input = toInput(subscription);
      try {
        if (!input) throw new Error("Incomplete subscription");
        await client.push.subscribe.mutate(input);
      } catch (error) {
        // The server refused it: do not leave a subscription nobody sends to.
        await subscription.unsubscribe();
        throw error;
      }
      writeOwner(userId);
      setSubscribed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!registration) return;
    setBusy(true);
    setFailed(false);
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const { endpoint } = subscription;
        await subscription.unsubscribe();
        await client.push.unsubscribe.mutate({ endpoint });
      }
      writeOwner(null);
      setSubscribed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  let state: PushState;
  if (!publicKey) state = "hidden";
  else if (isIos && !isStandalone) state = "install-first";
  else if (!supported) state = "unsupported";
  else if (permission === "denied") state = "denied";
  else state = subscribed ? "on" : "off";

  // Busy while a switch is in flight, and until the browser has said
  // whether it holds a subscription.
  return { state, busy: busy || subscribed === null, failed, enable, disable };
}
