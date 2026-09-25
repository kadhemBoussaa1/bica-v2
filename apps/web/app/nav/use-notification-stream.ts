"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  NOTIFICATION_STREAM_PATH,
  notificationEvent,
  type NotificationEvent,
} from "@repo/api-contract";
import { API_URL } from "../purchasing/document-preview";
import { useTRPC } from "../trpc/client";

/** The hook's own retry, after EventSource has given up: 5 s doubling to 60 s. */
const BACKOFF_FIRST_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * The notification stream — docs/notifications-plan.md §5.2.
 *
 * One `EventSource` on `GET /events` while `enabled` (a signed-in shell) AND
 * the tab is visible (§5.3): over HTTP/1.1 a browser allows ~6 connections
 * per origin and an open stream holds one, so hidden tabs let theirs go and
 * fall back to the bell's poll. A hidden tab could not show a toast anyway.
 *
 * On `ready` — every connect and reconnect — the bell's queries are
 * invalidated: the database is the truth, so whatever happened while the
 * stream was down shows in the bell. On `notification` the same, and
 * `onEvent` decides about a toast.
 *
 * The hook owns reconnection. EventSource retries by itself only after a
 * network error or a clean end (the API's 15-minute close); any non-200
 * answer — nginx's 502/503 page while the API restarts, a 401 once the
 * session died — closes it for good (`readyState === CLOSED`). So on a
 * CLOSED error: re-check `me` (a dead session turns it null, the shell
 * unmounts the bell and this effect stops) and open a new stream after a
 * jittered backoff, reset by the next `ready`.
 */
export function useNotificationStream({
  enabled,
  onEvent,
}: {
  enabled: boolean;
  onEvent: (event: NotificationEvent) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // The latest callback without reopening the stream when it changes.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = BACKOFF_FIRST_MS;

    const refresh = () => {
      void queryClient.invalidateQueries(trpc.notification.pathFilter());
    };

    const disconnect = () => {
      if (retry !== null) clearTimeout(retry);
      retry = null;
      source?.close();
      source = null;
    };

    const connect = () => {
      if (source !== null || retry !== null || document.visibilityState !== "visible") return;
      const stream = new EventSource(`${API_URL}${NOTIFICATION_STREAM_PATH}`, {
        withCredentials: true,
      });
      source = stream;
      stream.addEventListener("ready", () => {
        backoff = BACKOFF_FIRST_MS;
        refresh();
      });
      stream.addEventListener("notification", (message) => {
        refresh();
        let data: unknown;
        try {
          data = JSON.parse((message as MessageEvent<string>).data);
        } catch {
          return;
        }
        const parsed = notificationEvent.safeParse(data);
        if (parsed.success) onEventRef.current(parsed.data);
      });
      stream.onerror = () => {
        // CONNECTING: the browser's own retry is under way.
        if (stream.readyState !== EventSource.CLOSED) return;
        stream.close();
        if (source === stream) source = null;
        void queryClient.invalidateQueries({ queryKey: trpc.me.queryKey() });
        const delay = backoff * (0.8 + Math.random() * 0.4);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        retry = setTimeout(() => {
          retry = null;
          connect();
        }, delay);
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") connect();
      else disconnect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      disconnect();
    };
  }, [enabled, queryClient, trpc]);
}
