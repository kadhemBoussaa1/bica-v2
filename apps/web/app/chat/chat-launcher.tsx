"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCurrentUser } from "../auth/use-auth";
import { useTRPC } from "../trpc/client";
import { ChatRoom } from "./chat-room";
import styles from "./chat.module.css";

const int = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Initials for the avatar chip. Two letters where the name has two words, so
 * "Nabil Ben Ali" reads NB rather than N — the same rule as the top bar's
 * avatar, kept in step by hand because that helper is not exported.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Two overlapping speech bubbles — the launcher's whole identity. */
function BubblesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h10.5v7H7.5L4 13.5V4Z" />
      <path d="M9.5 13.5h3.2l3.3 3v-3H20V8.5h-2.5" />
    </svg>
  );
}

function CloseGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** A minus, not a cross: the panel is dismissed, not discarded. */
function MinimiseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  );
}

function PeopleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6" />
      <path d="M16 5.5a3 3 0 0 1 0 5.4M17.5 14.6c2 .6 3.3 2 3.3 4.4" />
    </svg>
  );
}

/**
 * The corner chat launcher — a floating button on every signed-in page that
 * opens the shared notice stream in a panel over the current screen.
 *
 * This is the ONLY chat surface: there is no `/chat` route. A notice stream is
 * not a destination you navigate to and stay at — the reason to read it is
 * almost always something you are doing somewhere else, and a nav row forced
 * you to leave that page to see whether a machine had gone down. The panel
 * keeps the page underneath, and the unread count stays in view from anywhere.
 *
 * Renders nothing without a session, like `Sidebar` and `TopBar`, so /login is
 * unaffected.
 */
export function ChatLauncher() {
  const t = useTranslations("chat");
  const trpc = useTRPC();
  const pathname = usePathname();
  const { user } = useCurrentUser();
  /*
   * The pathname the panel was opened on, not a boolean — the same shape as
   * the sidebar's mobile drawer (`useDrawer` in nav/use-sidebar.ts).
   *
   * Closing on navigation then falls out of the comparison below instead of
   * needing a ref or an effect to notice: any pathname other than the one it
   * was opened on reads as closed, because navigating is a completed intent
   * and the panel should not linger over the page just asked for.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  /*
   * Whether the button itself is hidden. The reference design puts a small
   * dismiss chip on the launcher: someone working a long shift on one screen
   * can get the bubble out of the way without it coming back on every render.
   * Deliberately not persisted — it returns on the next page load, because a
   * permanently hidden notice stream would quietly defeat the point of having
   * one.
   */
  const [dismissed, setDismissed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  /*
   * The unread badge: the server's count of notices newer than this
   * account's read stamp and written by someone else (`ChatService.
   * unreadCount`). Its own query rather than part of `nav.counts`: a bare
   * total of every notice ever posted would read as a table size rather
   * than as work.
   *
   * Polled every twenty seconds, and again whenever the tab comes back into
   * view: this is an ambient figure on every page in the app, cheap on the
   * server (one indexed count), and a notice from the floor should not sit
   * unannounced for a minute. The open panel does its own faster polling
   * and marks read as it goes, which refreshes this count at once.
   */
  const unreadQuery = useQuery({
    ...trpc.chat.unread.queryOptions(),
    enabled: user !== null,
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const close = useCallback(() => {
    setOpenedOn(null);
    // Return focus to the button, or a keyboard user is dropped at the top of
    // the document with no idea where the panel went.
    buttonRef.current?.focus();
  }, []);

  // Escape closes, and a click outside dismisses — the same two affordances
  // the top bar's jump popover has. No scroll lock: the point of the panel is
  // that the page underneath stays usable.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpenedOn(null);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  if (!user) return null;

  const unread = unreadQuery.data || 0;
  const displayName = user.name || user.email;

  return (
    <>
      {open && (
        <div className={styles.launcherWrap}>
          {/* Mobile only: a scrim, because at phone width the panel covers the
              screen and the page behind it is no longer usable anyway. */}
          <div className={styles.panelScrim} aria-hidden="true" />

          <div
            ref={panelRef}
            className={styles.panel}
            role="dialog"
            aria-modal="false"
            aria-label={t("title")}
          >
            <div className={styles.panelHead}>
              <span className={styles.panelMark} aria-hidden="true">
                <BubblesIcon />
              </span>

              <span className={styles.panelHeading}>
                <span className={styles.panelTitle}>{t("title")}</span>
                <span className={styles.panelSub}>{t("panel.everyone")}</span>
              </span>

              {/* The reader's own chip. One avatar, not a presence stack:
                  nothing in this app tracks who is online, and a row of faces
                  implying otherwise would be a lie told in pixels. */}
              <span className={styles.panelAvatar} title={displayName}>
                {initials(displayName)}
              </span>

              <button
                type="button"
                className={styles.panelClose}
                onClick={close}
                aria-label={t("launcher.close")}
              >
                <MinimiseGlyph />
              </button>
            </div>

            <div className={styles.panelNotice}>
              <PeopleGlyph />
              <span>{t("panel.visibleToAll")}</span>
            </div>

            {/* The full room, in its compact skin. One implementation: the
                polling, merge and scroll rules are identical, and a second
                copy would drift. */}
            <ChatRoom variant="panel" />
          </div>
        </div>
      )}

      {!dismissed && (
        <div className={styles.launcherDock}>
          {/* Sits above the button, like the reference. Hides the bubble for
              this page load only. */}
          <button
            type="button"
            className={styles.launcherDismiss}
            onClick={() => {
              setOpenedOn(null);
              setDismissed(true);
            }}
            aria-label={t("launcher.dismiss")}
          >
            <CloseGlyph size={11} />
          </button>

          <button
            ref={buttonRef}
            type="button"
            className={styles.launcher}
            onClick={() => setOpenedOn(open ? null : pathname)}
            aria-expanded={open}
            aria-label={
              unread > 0
                ? `${t("launcher.open")} — ${t("feed.new", { count: unread })}`
                : t("launcher.open")
            }
          >
            <BubblesIcon />
            {!open && unread > 0 && (
              <span className={styles.launcherBadge}>{int.format(unread)}</span>
            )}
          </button>
        </div>
      )}
    </>
  );
}
