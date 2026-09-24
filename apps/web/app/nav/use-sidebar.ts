"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "bicapack.sidebar.collapsed";

/**
 * localStorage as an external store.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: it is the
 * primitive built for reading state React does not own, it takes a separate
 * server snapshot so SSR and hydration agree, and it keeps two open tabs in
 * step through the `storage` event. Reading storage in an effect would also
 * work, but the React Compiler's lint rules reject setState in an effect body,
 * and rightly — it is a cascading render.
 */

/** Subscribers in THIS tab, notified by `toggle` since `storage` will not be. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  // `storage` fires in OTHER tabs, so this only handles cross-tab sync; the
  // toggle in this tab notifies its own subscribers explicitly.
  window.addEventListener("storage", onChange);
  listeners.add(onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode or blocked storage: expanded is the safe default.
    return false;
  }
}

/**
 * The server has no localStorage, so it always reports expanded. React uses
 * this for SSR and for the hydration pass, then re-reads the client snapshot —
 * which is why `ready` below exists to suppress the transition on that switch.
 */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Desktop rail state, persisted per browser.
 *
 * `ready` is false for the first paint and true from the first effect onward.
 * The shell uses it to suppress the width transition, so a rail restored from
 * storage appears already narrow instead of visibly sliding shut on load.
 */
export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    // Guarded so this setState runs once, on mount, rather than on every
    // commit — the one place an effect legitimately flips render-only state.
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
  }, []);

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, getSnapshot() ? "0" : "1");
    } catch {
      // Preference is a convenience; losing it must never break navigation.
    }
    // `storage` does not fire in the tab that wrote, so notify locally.
    listeners.forEach((listener) => listener());
  }, []);

  return { collapsed, toggle, ready };
}

/**
 * Mobile drawer state, shared between the top bar (which opens it) and the
 * sidebar (which renders it). A module-level store read through
 * `useSyncExternalStore`, like the collapse preference above, so the two
 * components need no common ancestor.
 *
 * Closing on navigation is derived rather than reset in an effect: the store
 * holds the pathname the drawer was opened on, and any different pathname
 * means the user has navigated, so it reads as closed. Navigating is a
 * completed intent — the drawer should not linger over the page just asked for.
 */
let openedAt: string | null = null;
const drawerListeners = new Set<() => void>();

function subscribeDrawer(onChange: () => void) {
  drawerListeners.add(onChange);
  return () => {
    drawerListeners.delete(onChange);
  };
}

function setOpenedAt(next: string | null) {
  openedAt = next;
  drawerListeners.forEach((listener) => listener());
}

export function useDrawer(pathname: string) {
  const current = useSyncExternalStore(
    subscribeDrawer,
    () => openedAt,
    () => null,
  );
  const open = current === pathname;

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenedAt(next ? pathname : null);
    },
    [pathname],
  );

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedAt(null);
    };
    document.addEventListener("keydown", onKeyDown);

    // Scroll lock. The previous inline value is restored rather than cleared,
    // so this cannot clobber an overflow set by something else.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return { open, setOpen };
}
