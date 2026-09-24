"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "../trpc/client";

/**
 * "I have read up to here", kept on the SERVER per account (`ChatRead`),
 * replacing the per-browser localStorage stamp.
 *
 * Per account, not per browser: the same person on a phone and a desktop
 * reads one stream and should carry one badge, and a fresh browser must not
 * silently count the whole history as read. The launcher's badge is the
 * server's count of notices newer than the stamp and written by someone
 * else; marking read advances the stamp and refreshes that count.
 *
 * A module-level high-water mark keeps the tab from sending the same stamp
 * twice: the feed reports "reached the bottom" on every poll while it sits
 * there, and only a newer notice should cost a request.
 */
let sent: string | null = null;

export function useLastSeen() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const markMutation = useMutation(
    trpc.chat.markRead.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.chat.unread.queryKey() }),
    }),
  );
  const { mutate } = markMutation;

  const mark = useCallback(
    (when: Date | string) => {
      const iso = typeof when === "string" ? when : when.toISOString();
      // Monotonic here as well as on the server: no request for a stamp the
      // tab has already sent or one older than it.
      if (sent !== null && sent >= iso) return;
      sent = iso;
      mutate({ at: iso });
    },
    [mutate],
  );

  /**
   * Mark read only if the reader could actually have seen it.
   *
   * A panel left open on a background tab would otherwise keep marking every
   * arriving notice as read — the feed sits at its bottom, so the "reached the
   * bottom" signal fires on each poll — and someone who leaves chat open in a
   * spare tab would never see a badge again. Visibility is the honest proxy
   * for "this was on screen".
   */
  const markIfVisible = useCallback(
    (when: Date | string) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      mark(when);
    },
    [mark],
  );

  return { mark, markIfVisible };
}
